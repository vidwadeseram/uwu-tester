import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import {
  allowedWorkspaceRoots,
  buildAgentDocs,
  buildTestConfigFromContext,
  collectWorkspaceContext,
  DiscovererCase,
  DiscovererMergeReport,
  DiscovererTestConfig,
  DiscovererWorkflow,
  inferProjectSlugFromWorkspace,
  mergeDiscovererTestConfig,
  resolveKnowledgeFilePath,
  resolveWorkspacePath,
  safeProjectSlug,
  writeKnowledge,
} from "@/app/lib/discoverer";
import { recordDiscovererHistory } from "@/app/lib/discoverer-history";
import { readEnvKeys, readSettings } from "@/app/lib/settings";

export const dynamic = "force-dynamic";

const REGRESSION_DIR = path.join(process.cwd(), "..", "regression_tests");
const TEST_CASES_DIR = path.join(REGRESSION_DIR, "test_cases");
const DISCOVERER_PROMPT_DIR = path.join(REGRESSION_DIR, "results", "discoverer", "cli_prompts");

interface DiscovererRequest {
  workspacePath?: string;
  project?: string;
  persistTests?: boolean;
  persistDocs?: boolean;
  testSavePath?: string;
  docsSavePath?: string;
  generationTarget?: "api" | "claude" | "opencode";
}

interface DiscovererAiOutput {
  description: string;
  test_cases: DiscovererCase[];
  workflows: DiscovererWorkflow[];
  agent_docs: string;
}

interface CliRunResult {
  stdout: string;
  stderr: string;
  code: number;
  errorMessage?: string;
}

function normalizeForCompare(input: string): string {
  return path.resolve(input).replace(/\\+/g, "/").replace(/\/+$/, "");
}

function isWithinAnyAllowedRoot(candidate: string): boolean {
  const normalizedCandidate = normalizeForCompare(candidate);
  return allowedWorkspaceRoots().some((root) => {
    const normalizedRoot = normalizeForCompare(root);
    return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
  });
}

function resolvePersistPath(raw: string, workspacePath: string): string | null {
  if (!raw.trim()) return "";
  const candidate = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(workspacePath, raw);
  if (!isWithinAnyAllowedRoot(candidate)) return null;
  return candidate;
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readOptionalFileText(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function summarizeCliText(raw: string, maxChars = 500): string {
  const redacted = raw.replace(/args=\[[\s\S]*?\]\s*opencode/gi, "args=[...redacted] opencode");
  const compact = redacted.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.length > maxChars ? `${compact.slice(0, maxChars)}…` : compact;
}

function trimErrorMessage(raw: string, maxChars = 420): string {
  const compact = raw.replace(/\s+/g, " ").trim();
  if (!compact) return "Discoverer generation failed";
  return compact.length > maxChars ? `${compact.slice(0, maxChars)}…` : compact;
}

function writeCliPromptFile(target: "claude" | "opencode", project: string, prompt: string): string {
  ensureDir(DISCOVERER_PROMPT_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z");
  const token = Math.random().toString(36).slice(2, 8);
  const filePath = path.join(DISCOVERER_PROMPT_DIR, `${target}-${project}-${stamp}-${token}.txt`);
  fs.writeFileSync(filePath, prompt);
  return filePath;
}

function parseCliJson(stdout: string, stderr: string): unknown {
  const candidates = [stdout.trim(), stderr.trim()].filter((value) => value.length > 0);
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return extractJsonPayload(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("Model output was not valid JSON");
}

function compactWorkspaceContext(ctx: ReturnType<typeof collectWorkspaceContext>) {
  return {
    workspaceName: ctx.workspaceName,
    workspacePath: ctx.workspacePath,
    fileCount: ctx.fileCount,
    stackHints: ctx.stackHints,
    runScripts: ctx.runScripts.slice(0, 20),
    routeHints: ctx.routeHints.slice(0, 40),
    sampledFiles: ctx.sampledFiles.slice(0, 160),
    keyFiles: ctx.keyFiles.slice(0, 12),
  };
}

function extractJsonPayload(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const sliced = candidate.slice(start, end + 1);
      return JSON.parse(sliced);
    }
    throw new Error("Model output was not valid JSON");
  }
}

function sanitizeId(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

function normalizeAiOutput(project: string, raw: unknown): DiscovererAiOutput {
  if (!raw || typeof raw !== "object") {
    throw new Error("Discoverer AI output must be an object");
  }
  const record = raw as Record<string, unknown>;

  const description = typeof record.description === "string" ? record.description.trim() : "";
  const agentDocs = typeof record.agent_docs === "string" ? record.agent_docs.trim() : "";
  const testCasesRaw = Array.isArray(record.test_cases) ? record.test_cases : [];
  const workflowsRaw = Array.isArray(record.workflows) ? record.workflows : [];

  const testCases = testCasesRaw
    .map((value, idx): DiscovererCase | null => {
      if (!value || typeof value !== "object") return null;
      const row = value as Record<string, unknown>;
      const idSource = typeof row.id === "string" && row.id.trim() ? row.id : `case_${idx + 1}`;
      const id = sanitizeId(idSource);
      const label = typeof row.label === "string" ? row.label.trim() : "";
      const task = typeof row.task === "string" ? row.task.trim() : "";
      if (!id || !label || !task) return null;
      const dependsOn = typeof row.depends_on === "string" && row.depends_on.trim()
        ? sanitizeId(row.depends_on)
        : null;
      const nextCase: DiscovererCase = {
        id,
        label,
        task,
        enabled: row.enabled !== false,
        depends_on: dependsOn,
        skip_dependents_on_fail: row.skip_dependents_on_fail === true,
      };
      return nextCase;
    })
    .filter((v): v is DiscovererCase => v !== null);

  if (testCases.length === 0) {
    throw new Error("Discoverer AI did not produce valid test cases");
  }

  const knownCaseIds = new Set(testCases.map((tc) => tc.id));

  const workflows = workflowsRaw
    .map((value, idx): DiscovererWorkflow | null => {
      if (!value || typeof value !== "object") return null;
      const row = value as Record<string, unknown>;
      const idSource = typeof row.id === "string" && row.id.trim() ? row.id : `workflow_${idx + 1}`;
      const id = sanitizeId(idSource);
      const label = typeof row.label === "string" ? row.label.trim() : "";
      if (!id || !label) return null;
      const caseIdsRaw = Array.isArray(row.case_ids) ? row.case_ids : [];
      const caseIds = caseIdsRaw
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => sanitizeId(entry))
        .filter((entry) => knownCaseIds.has(entry));
      if (caseIds.length === 0) return null;
      const nextWorkflow: DiscovererWorkflow = {
        id,
        label,
        description: typeof row.description === "string" ? row.description.trim() : undefined,
        enabled: row.enabled !== false,
        case_ids: Array.from(new Set(caseIds)),
      };
      return nextWorkflow;
    })
    .filter((v): v is DiscovererWorkflow => v !== null);

  if (workflows.length === 0) {
    workflows.push({
      id: "full",
      label: "Full",
      description: "Run all generated cases",
      enabled: true,
      case_ids: testCases.map((tc) => tc.id),
    });
  }

  return {
    description: description || `Discoverer AI generation for ${project}`,
    test_cases: testCases,
    workflows,
    agent_docs: agentDocs || `# ${project} — Agent Knowledge\n\nNo documentation was returned by model.`,
  };
}

async function generateWithModel(project: string, context: ReturnType<typeof collectWorkspaceContext>): Promise<{ testConfig: DiscovererTestConfig; agentDocs: string; model: string }> {
  const keys = readEnvKeys();
  const openrouterKey = keys.OPENROUTER_API_KEY;
  if (!openrouterKey) {
    throw new Error("OpenRouter API key is required for Discoverer generation. Add it in Settings > API Keys.");
  }

  const settings = readSettings();
  const model = settings.models?.discoverer ?? "openrouter/free";

  const userPrompt = [
    "Generate realistic, workspace-specific QA artifacts.",
    "Return strictly valid JSON with this exact shape:",
    "{",
    '  "description": string,',
    '  "test_cases": [{ "id": string, "label": string, "task": string, "enabled": boolean, "depends_on": string|null, "skip_dependents_on_fail": boolean }],',
    '  "workflows": [{ "id": string, "label": string, "description": string, "enabled": boolean, "case_ids": string[] }],',
    '  "agent_docs": string',
    "}",
    "Rules:",
    "- Make test cases specific to discovered routes, scripts, and architecture.",
    "- Use placeholders like {{BASE_URL}}, {{LOGIN_ID}}, {{PASSWORD}} only when required.",
    "- Do not output markdown fences. Output JSON only.",
    "- case_ids in workflows must reference generated test case ids.",
    "Workspace context:",
    JSON.stringify(compactWorkspaceContext(context), null, 2),
  ].join("\n");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openrouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://uwu-code.local",
      "X-Title": "discoverer",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "You are Discoverer, a QA and documentation generation assistant. Return only valid JSON.",
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
    }),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const message = (errorBody as { error?: { message?: string } })?.error?.message;
    throw new Error(message || `Discoverer model request failed (${res.status})`);
  }

  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Discoverer model returned empty content");
  }

  const parsed = extractJsonPayload(content);
  const normalized = normalizeAiOutput(project, parsed);

  return {
    testConfig: {
      project,
      description: normalized.description,
      test_cases: normalized.test_cases,
      workflows: normalized.workflows,
    },
    agentDocs: normalized.agent_docs,
    model,
  };
}

function runCli(
  file: string,
  args: string[],
  cwd: string,
  envOverrides?: Record<string, string>,
  envStrip?: string[]
): Promise<CliRunResult> {
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: process.env.HOME || "/home/uwu",
      PATH: `${process.env.PATH ?? ""}:/usr/local/bin:/opt/homebrew/bin:/home/uwu/.local/bin`,
      ...(envOverrides ?? {}),
    };
    for (const key of envStrip ?? []) {
      delete env[key];
    }

    execFile(
      file,
      args,
      {
        cwd,
        env,
        maxBuffer: 20 * 1024 * 1024,
        timeout: 180_000,
      },
      (error, stdout, stderr) => {
        let code = 0;
        if (error) {
          const rawCode = (error as NodeJS.ErrnoException).code;
          if (typeof rawCode === "number") {
            code = rawCode;
          } else if (typeof rawCode === "string") {
            const parsedCode = Number(rawCode);
            code = Number.isFinite(parsedCode) ? parsedCode : 1;
          } else {
            code = 1;
          }
        }
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          code,
          errorMessage: error ? String((error as Error).message ?? "") : undefined,
        });
      }
    );
  });
}

function resolveCommandCandidates(target: "claude" | "opencode"): string[] {
  if (target === "claude") {
    return [
      process.env.CLAUDE_BIN?.trim() ?? "",
      "claude",
      "/usr/local/bin/claude",
      "/opt/homebrew/bin/claude",
      "/home/uwu/.local/bin/claude",
    ].filter(Boolean);
  }
  return [
    process.env.OPENCODE_BIN?.trim() ?? "",
    "opencode",
    "/usr/local/bin/opencode",
    "/opt/homebrew/bin/opencode",
    "/home/uwu/.local/bin/opencode",
  ].filter(Boolean);
}

function discovererCliPrompt(context: ReturnType<typeof collectWorkspaceContext>): string {
  return [
    "You are Discoverer. Generate realistic, workspace-specific QA artifacts.",
    "Return strictly valid JSON with this exact shape:",
    "{",
    '  "description": string,',
    '  "test_cases": [{ "id": string, "label": string, "task": string, "enabled": boolean, "depends_on": string|null, "skip_dependents_on_fail": boolean }],',
    '  "workflows": [{ "id": string, "label": string, "description": string, "enabled": boolean, "case_ids": string[] }],',
    '  "agent_docs": string',
    "}",
    "Rules:",
    "- Make test cases specific to discovered routes, scripts, and architecture.",
    "- Use placeholders like {{BASE_URL}}, {{LOGIN_ID}}, {{PASSWORD}} only when required.",
    "- Do not output markdown fences. Output JSON only.",
    "- case_ids in workflows must reference generated test case ids.",
    "Workspace context:",
    JSON.stringify(compactWorkspaceContext(context), null, 2),
  ].join("\n");
}

async function generateWithCli(
  target: "claude" | "opencode",
  project: string,
  context: ReturnType<typeof collectWorkspaceContext>
): Promise<{ testConfig: DiscovererTestConfig; agentDocs: string; model: string }> {
  const prompt = discovererCliPrompt(context);
  const promptFile = writeCliPromptFile(target, project, prompt);
  const candidates = resolveCommandCandidates(target);
  const cwd = context.workspacePath;
  const envKeys = readEnvKeys();
  const runtimeHome = (() => {
    const preferred = (process.env.HOME ?? "").trim();
    if (preferred) {
      try {
        if (!fs.existsSync(preferred)) {
          fs.mkdirSync(preferred, { recursive: true });
        }
        return preferred;
      } catch {}
    }
    const fallback = path.join(REGRESSION_DIR, "results", "discoverer", "cli_home");
    if (!fs.existsSync(fallback)) {
      fs.mkdirSync(fallback, { recursive: true });
    }
    return fallback;
  })();
  const xdgConfig = path.join(runtimeHome, ".config");
  const xdgData = path.join(runtimeHome, ".local", "share");
  if (!fs.existsSync(xdgConfig)) {
    fs.mkdirSync(xdgConfig, { recursive: true });
  }
  if (!fs.existsSync(xdgData)) {
    fs.mkdirSync(xdgData, { recursive: true });
  }

  const envOverrides: Record<string, string> = {
    HOME: runtimeHome,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_DATA_HOME: xdgData,
  };
  for (const key of ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"] as const) {
    const value = envKeys[key]?.trim();
    if (value) {
      envOverrides[key] = value;
    }
  }

  const attemptErrors: string[] = [];
  for (const command of candidates) {
    const envStrip = target === "opencode"
      ? ["OPENCODE_SERVER_PASSWORD", "OPENCODE_SERVER_USERNAME", "OPENCODE_CLIENT"]
      : [];

    const versionCheck = await runCli(command, ["--version"], cwd, envOverrides, envStrip);
    if (versionCheck.code !== 0) {
      const reason = versionCheck.stderr.trim() || versionCheck.stdout.trim() || versionCheck.errorMessage || "no output";
      attemptErrors.push(`${target} command '${command}' is not runnable: ${reason}`);
      continue;
    }

    const variants = target === "claude"
      ? [
          {
            name: "default",
            args: ["--dangerously-skip-permissions", "-p", prompt],
          },
        ]
      : [
          {
            name: "default",
            args: [
              "run",
              "--dir",
              context.workspacePath,
              "-f",
              promptFile,
              "Read the attached file and output ONLY the final JSON object requested there.",
            ],
          },
          {
            name: "pure",
            args: [
              "run",
              "--pure",
              "--dir",
              context.workspacePath,
              "-f",
              promptFile,
              "Read the attached file and output ONLY the final JSON object requested there.",
            ],
          },
        ];

    for (const variant of variants) {
      const result = await runCli(command, variant.args, cwd, envOverrides, envStrip);
      const stdout = result.stdout.trim();
      const stderr = result.stderr.trim();

      if (result.code !== 0) {
        const reason = summarizeCliText(stdout || stderr || result.errorMessage || "no output");
        attemptErrors.push(
          `${target} command '${command}' [${variant.name}] failed (${result.code}): ${reason || "no output"}`
        );
        continue;
      }

      if (!stdout && !stderr) {
        attemptErrors.push(`${target} command '${command}' [${variant.name}] returned success with empty output`);
        continue;
      }

      try {
        const parsed = parseCliJson(stdout, stderr);
        const normalized = normalizeAiOutput(project, parsed);
        return {
          testConfig: {
            project,
            description: normalized.description,
            test_cases: normalized.test_cases,
            workflows: normalized.workflows,
          },
          agentDocs: normalized.agent_docs,
          model: `cli/${target}`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attemptErrors.push(`${target} command '${command}' [${variant.name}] produced invalid JSON output: ${trimErrorMessage(message, 240)}`);
      }
    }
  }

  throw new Error(trimErrorMessage(attemptErrors.join(" | ") || `${target} CLI generation failed`, 900));
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }

  const parsed = body as DiscovererRequest;

  if (parsed.workspacePath !== undefined && typeof parsed.workspacePath !== "string") {
    return NextResponse.json({ error: "workspacePath must be a string" }, { status: 400 });
  }
  if (parsed.project !== undefined && typeof parsed.project !== "string") {
    return NextResponse.json({ error: "project must be a string" }, { status: 400 });
  }
  if (parsed.persistTests !== undefined && typeof parsed.persistTests !== "boolean") {
    return NextResponse.json({ error: "persistTests must be a boolean" }, { status: 400 });
  }
  if (parsed.persistDocs !== undefined && typeof parsed.persistDocs !== "boolean") {
    return NextResponse.json({ error: "persistDocs must be a boolean" }, { status: 400 });
  }
  if (parsed.testSavePath !== undefined && typeof parsed.testSavePath !== "string") {
    return NextResponse.json({ error: "testSavePath must be a string" }, { status: 400 });
  }
  if (parsed.docsSavePath !== undefined && typeof parsed.docsSavePath !== "string") {
    return NextResponse.json({ error: "docsSavePath must be a string" }, { status: 400 });
  }

  const workspacePath = (parsed.workspacePath ?? "").trim();
  if (!workspacePath) {
    return NextResponse.json({ error: "workspacePath required" }, { status: 400 });
  }

  const normalizedWorkspace = resolveWorkspacePath(workspacePath);
  if (!normalizedWorkspace) {
    const roots = allowedWorkspaceRoots();
    return NextResponse.json(
      { error: `workspacePath must be an accessible directory under allowed roots: ${roots.join(", ")}` },
      { status: 400 }
    );
  }

  const explicitProject = (parsed.project ?? "").trim();
  const project = safeProjectSlug(explicitProject || inferProjectSlugFromWorkspace(normalizedWorkspace));
  if (!project) {
    return NextResponse.json({ error: "Unable to infer a valid project slug" }, { status: 400 });
  }

  const persistTests = parsed.persistTests !== false;
  const persistDocs = parsed.persistDocs !== false;
  const testSavePath = (parsed.testSavePath ?? "").trim();
  const docsSavePath = (parsed.docsSavePath ?? "").trim();
  const generationTarget = parsed.generationTarget ?? "api";
  const resolvedTestSavePath = resolvePersistPath(testSavePath, normalizedWorkspace);
  const resolvedDocsSavePath = resolvePersistPath(docsSavePath, normalizedWorkspace);

  if (generationTarget !== "api" && generationTarget !== "claude" && generationTarget !== "opencode") {
    return NextResponse.json({ error: "generationTarget must be api|claude|opencode" }, { status: 400 });
  }

  if (testSavePath && !resolvedTestSavePath) {
    return NextResponse.json(
      { error: `testSavePath must be under allowed roots: ${allowedWorkspaceRoots().join(", ")}` },
      { status: 400 }
    );
  }

  if (docsSavePath && !resolvedDocsSavePath) {
    return NextResponse.json(
      { error: `docsSavePath must be under allowed roots: ${allowedWorkspaceRoots().join(", ")}` },
      { status: 400 }
    );
  }

  const context = collectWorkspaceContext(normalizedWorkspace);

  let generatedTestConfig: DiscovererTestConfig;
  let agentDocs: string;
  let generationModel = "";
  let generationWarning = "";

  try {
    const generated = generationTarget === "api"
      ? await generateWithModel(project, context)
      : await generateWithCli(generationTarget, project, context);
    generatedTestConfig = generated.testConfig;
    agentDocs = generated.agentDocs;
    generationModel = generated.model;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Discoverer generation failed";
    generatedTestConfig = buildTestConfigFromContext(project, context);
    agentDocs = buildAgentDocs(project, context);
    generationModel = "fallback/local-context";
    generationWarning = `${trimErrorMessage(message)}. Used local workspace fallback generation.`;
  }

  let effectiveTestConfig = generatedTestConfig;

  let testCasesFile = "";
  let knowledgeFile = "";
  let testsMode: "created" | "merged" | "unchanged" | "skipped" = "skipped";
  let docsMode: "created" | "appended" | "unchanged" | "skipped" = "skipped";
  let testsMerge: DiscovererMergeReport | undefined;

  const targetTestsFile = persistTests
    ? path.join(resolvedTestSavePath || TEST_CASES_DIR, `${project}.json`)
    : "";
  const targetDocsFile = persistDocs
    ? resolveKnowledgeFilePath(project, resolvedDocsSavePath || undefined)
    : "";

  const testsBeforeContent = targetTestsFile ? readOptionalFileText(targetTestsFile) : null;
  const docsBeforeContent = targetDocsFile ? readOptionalFileText(targetDocsFile) : null;

  if (persistTests) {
    const resolvedTestDir = resolvedTestSavePath || TEST_CASES_DIR;
    if (!fs.existsSync(resolvedTestDir)) {
      fs.mkdirSync(resolvedTestDir, { recursive: true });
    }
    testCasesFile = path.join(resolvedTestDir, `${project}.json`);

    if (fs.existsSync(testCasesFile)) {
      let existingRaw: unknown;
      try {
        existingRaw = JSON.parse(fs.readFileSync(testCasesFile, "utf-8"));
      } catch {
        return NextResponse.json(
          { error: "Existing Discoverer test config is not valid JSON and was not replaced" },
          { status: 409 }
        );
      }

      const merged = mergeDiscovererTestConfig(existingRaw, generatedTestConfig);
      if (!merged) {
        return NextResponse.json(
          { error: "Existing Discoverer test config is incompatible and was not replaced" },
          { status: 409 }
        );
      }

      effectiveTestConfig = merged.config;
      testsMode = merged.report.mode;
      testsMerge = merged.report;
      fs.writeFileSync(testCasesFile, JSON.stringify(effectiveTestConfig, null, 2));
    } else {
      fs.writeFileSync(testCasesFile, JSON.stringify(generatedTestConfig, null, 2));
      testsMode = "created";
    }
  }

  if (persistDocs) {
    const knowledge = writeKnowledge(project, agentDocs, normalizedWorkspace, resolvedDocsSavePath || undefined);
    knowledgeFile = knowledge.filePath;
    docsMode = knowledge.mode;
  }

  const historyEntry = recordDiscovererHistory({
    project,
    workspacePath: normalizedWorkspace,
    generationTarget,
    generationModel,
    generationWarning: generationWarning || undefined,
    tests: persistTests && testCasesFile
      ? { path: testCasesFile, beforeContent: testsBeforeContent }
      : undefined,
    docs: persistDocs && knowledgeFile
      ? { path: knowledgeFile, beforeContent: docsBeforeContent }
      : undefined,
  });

  return NextResponse.json({
    project,
    workspacePath: normalizedWorkspace,
    testConfig: effectiveTestConfig,
    agentDocs,
    context: {
      workspaceName: context.workspaceName,
      fileCount: context.fileCount,
      stackHints: context.stackHints,
      runScripts: context.runScripts,
      routeHints: context.routeHints,
    },
    persisted: {
      tests: persistTests,
      docs: persistDocs,
      testCasesFile: testCasesFile || undefined,
      knowledgeFile: knowledgeFile || undefined,
      testsMode,
      docsMode,
      testsMerge,
      generationModel,
      generationWarning: generationWarning || undefined,
      historyId: historyEntry?.id,
    },
  });
}
