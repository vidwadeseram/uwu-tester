import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  allowedWorkspaceRoots,
  collectWorkspaceContext,
  DiscovererCase,
  DiscovererMergeReport,
  DiscovererTestConfig,
  DiscovererWorkflow,
  inferProjectSlugFromWorkspace,
  mergeDiscovererTestConfig,
  resolveWorkspacePath,
  safeProjectSlug,
  writeKnowledge,
} from "@/app/lib/discoverer";
import { readEnvKeys, readSettings } from "@/app/lib/settings";

export const dynamic = "force-dynamic";

const REGRESSION_DIR = path.join(process.cwd(), "..", "regression_tests");
const TEST_CASES_DIR = path.join(REGRESSION_DIR, "test_cases");

interface DiscovererRequest {
  workspacePath?: string;
  project?: string;
  persistTests?: boolean;
  persistDocs?: boolean;
  testSavePath?: string;
  docsSavePath?: string;
}

interface DiscovererAiOutput {
  description: string;
  test_cases: DiscovererCase[];
  workflows: DiscovererWorkflow[];
  agent_docs: string;
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
  const resolvedTestSavePath = resolvePersistPath(testSavePath, normalizedWorkspace);
  const resolvedDocsSavePath = resolvePersistPath(docsSavePath, normalizedWorkspace);

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

  try {
    const generated = await generateWithModel(project, context);
    generatedTestConfig = generated.testConfig;
    agentDocs = generated.agentDocs;
    generationModel = generated.model;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Discoverer generation failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }

  let effectiveTestConfig = generatedTestConfig;

  let testCasesFile = "";
  let knowledgeFile = "";
  let testsMode: "created" | "merged" | "unchanged" | "skipped" = "skipped";
  let docsMode: "created" | "appended" | "unchanged" | "skipped" = "skipped";
  let testsMerge: DiscovererMergeReport | undefined;

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
    },
  });
}
