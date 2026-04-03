import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { collectWorkspaceContext } from "@/app/lib/discoverer";
import type { DiscovererTestConfig } from "@/app/lib/discoverer";
import { readEnvKeys, readSettings } from "@/app/lib/settings";
import type { DiscovererAiOutput, DeterministicGeneration, FetchedWebContext, CliRunResult } from "./types";
import { buildCoverageRoutes, compactWorkspaceContext, webContextBlock } from "./route-discovery";
import type { CoverageRoute } from "./route-discovery";

const REGRESSION_DIR = path.join(process.cwd(), "..", "regression_tests");
const DISCOVERER_PROMPT_DIR = path.join(REGRESSION_DIR, "results", "discoverer", "cli_prompts");

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function summarizeCliText(raw: string, maxChars = 500): string {
  const redacted = raw.replace(/args=\[[\s\S]*?\]\s*opencode/gi, "args=[...redacted] opencode");
  const compact = redacted.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.length > maxChars ? `${compact.slice(0, maxChars)}…` : compact;
}

export function trimErrorMessage(raw: string, maxChars = 420): string {
  const withoutAnsi = raw.replace(new RegExp("\\u001b\\[[0-9;]*m", "g"), "");
  const compact = withoutAnsi.replace(/\s+/g, " ").trim();
  if (!compact) return "Discoverer generation failed";
  return compact.length > maxChars ? `${compact.slice(0, maxChars)}…` : compact;
}

export function sanitizeId(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

export function extractJsonPayload(raw: string): unknown {
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

export function parseCliJson(stdout: string, stderr: string): unknown {
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

export function normalizeAiOutput(project: string, raw: unknown): DiscovererAiOutput {
  if (!raw || typeof raw !== "object") {
    throw new Error("Discoverer AI output must be an object");
  }
  const record = raw as Record<string, unknown>;

  const description = typeof record.description === "string" ? record.description.trim() : "";
  const agentDocs = typeof record.agent_docs === "string" ? record.agent_docs.trim() : "";
  const testCasesRaw = Array.isArray(record.test_cases) ? record.test_cases : [];
  const workflowsRaw = Array.isArray(record.workflows) ? record.workflows : [];

  const testCases = testCasesRaw
    .map((value: unknown, idx: number): import("@/app/lib/discoverer").DiscovererCase | null => {
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
      const nextCase: import("@/app/lib/discoverer").DiscovererCase = {
        id,
        label,
        task,
        enabled: row.enabled !== false,
        depends_on: dependsOn,
        skip_dependents_on_fail: row.skip_dependents_on_fail === true,
      };
      return nextCase;
    })
    .filter((v): v is import("@/app/lib/discoverer").DiscovererCase => v !== null);

  if (testCases.length === 0) {
    throw new Error("Discoverer AI did not produce valid test cases");
  }

  const knownCaseIds = new Set(testCases.map((tc) => tc.id));

  const workflows = workflowsRaw
    .map((value: unknown, idx: number): import("@/app/lib/discoverer").DiscovererWorkflow | null => {
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
      const nextWorkflow: import("@/app/lib/discoverer").DiscovererWorkflow = {
        id,
        label,
        description: typeof row.description === "string" ? row.description.trim() : undefined,
        enabled: row.enabled !== false,
        case_ids: Array.from(new Set(caseIds)),
      };
      return nextWorkflow;
    })
    .filter((v): v is import("@/app/lib/discoverer").DiscovererWorkflow => v !== null);

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

export function discovererApiModel(): string {
  const settings = readSettings();
  return settings.models?.discoverer_api ?? settings.models?.discoverer ?? "openrouter/free";
}

export function discovererCliModel(target: "claude" | "opencode"): string {
  const settings = readSettings();
  if (target === "claude") {
    return settings.models?.discoverer_claude ?? "sonnet";
  }
  return settings.models?.discoverer_opencode ?? "opencode/qwen3.6-plus-free";
}

export function writeCliPromptFile(target: "claude" | "opencode", project: string, prompt: string): string {
  ensureDir(DISCOVERER_PROMPT_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z");
  const token = Math.random().toString(36).slice(2, 8);
  const filePath = path.join(DISCOVERER_PROMPT_DIR, `${target}-${project}-${stamp}-${token}.txt`);
  fs.writeFileSync(filePath, prompt);
  return filePath;
}

export function discovererCliPrompt(
  context: ReturnType<typeof collectWorkspaceContext>,
  options?: { sourceUrl?: string; spec?: string; webContext?: FetchedWebContext },
  target?: "claude" | "opencode",
): string {
  const contextPayload = target === "opencode"
    ? compactWorkspaceContext(context, { runScripts: 10, routeHints: 24, sampledFiles: 60, keyFiles: 6 })
    : compactWorkspaceContext(context);
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
    options?.sourceUrl ? `Target URL to validate with Playwright MCP/spec: ${options.sourceUrl}` : "",
    options?.webContext ? webContextBlock(options.webContext) : "",
    options?.spec ? "Use this Playwright exploration spec as primary source of truth before workspace context:" : "",
    options?.spec ?? "",
    "Workspace context:",
    JSON.stringify(contextPayload, null, 2),
  ].join("\n");
}

export function resolveCommandCandidates(target: "claude" | "opencode"): string[] {
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

export function resolveCliRuntimeDirs(target: "claude" | "opencode"): {
  home: string;
  xdgConfig: string;
  xdgData: string;
} {
  if (target === "opencode" && fs.existsSync("/home/uwu")) {
    const home = "/home/uwu";
    return {
      home,
      xdgConfig: path.join(home, ".config"),
      xdgData: path.join(home, ".local", "share"),
    };
  }

  const preferred = (process.env.HOME ?? "").trim();
  if (preferred) {
    try {
      if (!fs.existsSync(preferred)) {
        fs.mkdirSync(preferred, { recursive: true });
      }
      return {
        home: preferred,
        xdgConfig: path.join(preferred, ".config"),
        xdgData: path.join(preferred, ".local", "share"),
      };
    } catch { /* fall through */ }
  }

  const fallback = path.join(REGRESSION_DIR, "results", "discoverer", "cli_home");
  if (!fs.existsSync(fallback)) {
    fs.mkdirSync(fallback, { recursive: true });
  }
  return {
    home: fallback,
    xdgConfig: path.join(fallback, ".config"),
    xdgData: path.join(fallback, ".local", "share"),
  };
}

export function runCli(
  file: string,
  args: string[],
  cwd: string,
  envOverrides?: Record<string, string>,
  envStrip?: string[],
  timeoutMs = 180_000,
  useTimeoutWrapper = false,
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

    let executable = file;
    let executableArgs = args;

    if (useTimeoutWrapper) {
      const timeoutCandidates = [process.env.TIMEOUT_BIN?.trim() ?? "", "/usr/bin/timeout", "timeout"].filter(Boolean);
      const timeoutBin = timeoutCandidates.find((candidate) => {
        if (candidate === "timeout") return true;
        return fs.existsSync(candidate);
      });
      if (timeoutBin) {
        const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
        executable = timeoutBin;
        executableArgs = ["-k", "30s", `${timeoutSec}s`, file, ...args];
      }
    }

    execFile(
      executable,
      executableArgs,
      {
        cwd,
        env,
        maxBuffer: 20 * 1024 * 1024,
        timeout: timeoutMs + 35_000,
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

export function deterministicSpec(sourceUrl: string, coverageRoutes: CoverageRoute[]): string {
  const safeUrl = sourceUrl || "http://localhost:3000";
  const routePaths = coverageRoutes.map((r) => r.path);
  const plannedRoutesJson = JSON.stringify(routePaths);
  return [
    "import { test, expect } from '@playwright/test';",
    "",
    "async function fillFirst(page, selectors, value) {",
    "  for (const selector of selectors) {",
    "    const locator = page.locator(selector).first();",
    "    try {",
    "      if (await locator.count() > 0) {",
    "        await locator.fill(value, { timeout: 3500 });",
    "        return selector;",
    "      }",
    "    } catch {}",
    "  }",
    "  return '';",
    "}",
    "",
    "async function clickByTexts(page, names) {",
    "  for (const name of names) {",
    "    const roleBtn = page.getByRole('button', { name: new RegExp(name, 'i') }).first();",
    "    try {",
    "      if (await roleBtn.count() > 0) {",
    "        await roleBtn.click({ timeout: 2500 });",
    "        return true;",
    "      }",
    "    } catch {}",
    "    const textBtn = page.locator(`button:has-text(\"${name}\"), a:has-text(\"${name}\")`).first();",
    "    try {",
    "      if (await textBtn.count() > 0) {",
    "        await textBtn.click({ timeout: 2500 });",
    "        return true;",
    "      }",
    "    } catch {}",
    "  }",
    "  return false;",
    "}",
    "",
    "async function detectOtpGate(page) {",
    "  const url = page.url().toLowerCase();",
    "  let body = '';",
    "  try { body = (await page.locator('body').innerText({ timeout: 3000 })).toLowerCase(); } catch {}",
    "  return url.includes('otp') || url.includes('verify') || body.includes('otp') || body.includes('verification');",
    "}",
    "",
    "test('deterministic full end-to-end workspace journey', async ({ page }) => {",
    "  test.setTimeout(180_000);",
    "  const targetUrl = process.env.UWU_SPEC_TARGET_URL || '" + safeUrl + "';",
    "  const webPhone = process.env.WEB_PHONE || process.env.WEB_USERNAME || '';",
    "  const webPassword = process.env.WEB_PASSWORD || '';",
    "  const otp = process.env.UWU_SPEC_OTP || '';",
    "  const visited = [];",
    "  const plannedRoutes = " + plannedRoutesJson + ";",
    "  let passed = false;",
    "  let summary = '';",
    "  let otpUsed = false;",
    "  try {",
    "    const initialResp = await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 45_000 });",
    "    expect(initialResp?.status()).toBeLessThan(500);",
    "    await page.waitForTimeout(1200);",
    "",
    "    const authTexts = ['login', 'log in', 'sign in', 'signin'];",
    "    const atLoginLike = /login|sign/.test(page.url().toLowerCase());",
    "    if (!atLoginLike) {",
    "      await clickByTexts(page, authTexts);",
    "      await page.waitForTimeout(1200);",
    "    }",
    "",
    "    if (webPhone) {",
    "      await fillFirst(page, [",
    "        \"input[type='tel']\",",
    "        \"input[name*='phone' i]\",",
    "        \"input[name*='mobile' i]\",",
    "        \"input[name*='username' i]\",",
    "        \"input[placeholder*='phone' i]\",",
    "        \"input[placeholder*='mobile' i]\",",
    "        \"input[placeholder*='username' i]\",",
    "        \"input:not([type='hidden']):not([type='password'])\",",
    "      ], webPhone);",
    "    }",
    "",
    "    if (webPassword) {",
    "      await fillFirst(page, [",
    "        \"input[type='password']\",",
    "        \"input[name*='password' i]\",",
    "        \"input[placeholder*='password' i]\",",
    "      ], webPassword);",
    "    }",
    "",
    "    await clickByTexts(page, ['login', 'log in', 'sign in', 'submit', 'continue']);",
    "    await page.waitForTimeout(1800);",
    "",
    "    if (await detectOtpGate(page)) {",
    "      if (!otp) throw new Error('OTP required but UWU_SPEC_OTP is empty');",
    "      const otpSelectors = [",
    "        \"input[name*='otp' i]\",",
    "        \"input[placeholder*='otp' i]\",",
    "        \"input[inputmode='numeric']\",",
    "      ];",
    "      let otpFilled = false;",
    "      for (const selector of otpSelectors) {",
    "        const loc = page.locator(selector);",
    "        try {",
    "          const count = await loc.count();",
    "          if (count <= 0) continue;",
    "          if (count >= otp.length) {",
    "            for (let i = 0; i < otp.length; i++) {",
    "              await loc.nth(i).fill(otp[i], { timeout: 2500 });",
    "            }",
    "          } else {",
    "            await loc.first().fill(otp, { timeout: 3500 });",
    "          }",
    "          otpFilled = true;",
    "          break;",
    "        } catch {}",
    "      }",
    "      if (!otpFilled) throw new Error('OTP gate detected but OTP inputs not fillable');",
    "      otpUsed = true;",
    "      await clickByTexts(page, ['verify', 'submit', 'continue', 'confirm']);",
    "      await page.waitForTimeout(2200);",
    "    }",
    "",
    "    const finalUrl = page.url().toLowerCase();",
    "    let finalBody = '';",
    "    try { finalBody = (await page.locator('body').innerText({ timeout: 4000 })).toLowerCase(); } catch {}",
    "    const authError = /(wrong\\s+password|invalid\\s+(username|password|credentials|otp)|incorrect\\s+(username|password|credentials|otp)|login failed|not authorized)/.test(finalBody);",
    "    const stillLogin = finalUrl.includes('login');",
    "    if (stillLogin && authError) throw new Error('Authentication failed after login submit');",
    "    let authMode = stillLogin ? 'logged_out_fallback' : 'authenticated';",
    "",
    "    const sameOriginLinks = await page.$$eval('a[href]', (anchors) => {",
    "      const current = window.location.origin;",
    "      const out = [];",
    "      const seen = new Set();",
    "      for (const anchor of anchors) {",
    "        const href = anchor.getAttribute('href') || '';",
    "        if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;",
    "        let full = href;",
    "        try { full = new URL(href, window.location.href).toString(); } catch { continue; }",
    "        if (!full.startsWith(current)) continue;",
    "        const lower = full.toLowerCase();",
    "        if (lower.includes('logout') || lower.includes('signout')) continue;",
    "        if (seen.has(full)) continue;",
    "        seen.add(full);",
    "        out.push(full);",
    "      }",
    "      return out.slice(0, 24);",
    "    });",
    "",
    "    const sameOriginPaths = sameOriginLinks.map((link) => {",
    "      try { return new URL(link).pathname || '/'; } catch { return '/'; }",
    "    });",
    "    const routeQueue = Array.from(new Set([...(plannedRoutes || []), ...sameOriginPaths]));",
    "    let reachable = 0;",
    "    for (const route of routeQueue) {",
    "      const full = new URL(route, targetUrl).toString();",
    "      const r = await page.goto(full, { waitUntil: 'domcontentloaded', timeout: 30_000 });",
    "      const routeStatus = r ? r.status() : 0;",
    "      if (routeStatus === 404) {",
    "        console.log('UWU_DISCOVERY_404=' + JSON.stringify({ route, status: routeStatus }));",
    "      }",
    "      if (r && routeStatus < 400) reachable += 1;",
    "      visited.push(new URL(full).pathname || '/');",
    "      await page.waitForTimeout(550);",
    "    }",
    "    const minExpectedReachable = Math.max(3, Math.min(10, Math.floor(routeQueue.length / 3)));",
    "    if (reachable < minExpectedReachable) {",
    "      throw new Error(`Route coverage too low (reachable=${reachable}, expected>=${minExpectedReachable}, mode=${authMode})`);",
    "    }",
    "",
    "    passed = true;",
    "    summary = `Full E2E complete: mode=${authMode} otp_used=${otpUsed} visited=${visited.length} planned=${plannedRoutes.length}`;",
    "  } catch (error) {",
    "    const text = error instanceof Error ? error.message : String(error);",
    "    summary = `Full E2E failed: ${text}`;",
    "    throw error;",
    "  } finally {",
    "    console.log('UWU_SPEC_RESULT=' + JSON.stringify({ passed, summary }));",
    "  }",
    "});",
    "",
  ].join("\n");
}

export function deterministicConfig(
  project: string,
  sourceUrl: string,
  context: ReturnType<typeof collectWorkspaceContext>,
  web: FetchedWebContext,
): DeterministicGeneration {
  const coverageRoutes = buildCoverageRoutes(sourceUrl, context, web);
  const routePaths = coverageRoutes.map((r) => r.path);
  const testConfig: DiscovererTestConfig = {
    project,
    description: `Deterministic full-site E2E Discoverer fallback for ${project}`,
    test_cases: [
      {
        id: "web_full_site_e2e",
        label: "Web full-site E2E",
        task: `Run login + optional OTP + broad route traversal from workspace and URL hints on ${sourceUrl || "the app"}`,
        enabled: true,
        depends_on: null,
        skip_dependents_on_fail: true,
      },
    ],
    workflows: [
      {
        id: "full",
        label: "Full",
        description: "Run deterministic full-site end-to-end journey",
        enabled: true,
        case_ids: ["web_full_site_e2e"],
      },
    ],
  };

  const agentDocs = [
    `# ${project} — Deterministic Fallback Docs`,
    "This fallback generates a full-site end-to-end web journey locally without external models.",
    "Journey: open target URL, perform login with WEB_PHONE/WEB_PASSWORD (or WEB_USERNAME), solve OTP via UWU_SPEC_OTP when challenged, then traverse route coverage derived from workspace route hints and discovered same-origin links.",
    `Planned route coverage (${routePaths.length}): ${routePaths.join(", ")}`,
  ].join("\n\n");

  return {
    spec: deterministicSpec(sourceUrl, coverageRoutes),
    testConfig,
    agentDocs,
    specModel: "fallback/local",
    generationModel: "fallback/local",
    warning: "Used deterministic local fallback because AI providers were unavailable (missing OpenRouter key or CLI timeout).",
  };
}

export async function generateWithModel(
  project: string,
  context: ReturnType<typeof collectWorkspaceContext>,
  options?: { sourceUrl?: string; spec?: string; webContext?: FetchedWebContext }
): Promise<{ testConfig: DiscovererTestConfig; agentDocs: string; model: string }> {
  const keys = readEnvKeys();
  const openrouterKey = keys.OPENROUTER_API_KEY;
  if (!openrouterKey) {
    throw new Error("OpenRouter API key is required for Discoverer generation. Add it in Settings > API Keys.");
  }

  const model = discovererApiModel();

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
    options?.sourceUrl ? `Target URL to validate with Playwright MCP/spec: ${options.sourceUrl}` : "",
    options?.webContext ? webContextBlock(options.webContext) : "",
    options?.spec ? "Use this Playwright exploration spec as primary source of truth before workspace context:" : "",
    options?.spec ?? "",
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

export async function generateSpecWithModel(
  _project: string,
  sourceUrl: string,
  context: ReturnType<typeof collectWorkspaceContext>,
  webContext: FetchedWebContext,
): Promise<{ spec: string; model: string }> {
  const keys = readEnvKeys();
  const openrouterKey = keys.OPENROUTER_API_KEY;
  if (!openrouterKey) {
    throw new Error("OpenRouter API key is required for Discoverer spec generation.");
  }

  const model = discovererApiModel();
  const prompt = [
    "You are Discoverer running a Playwright-first implementation pass.",
    "Create ONE runnable Python Playwright script (async API) for the target URL.",
    "Output MUST be raw Python source code only (no markdown, no fences).",
    "Required behavior:",
    "- Use async_playwright and launch Chromium headless.",
    "- Use context = browser.new_context(record_video_dir=recording_dir) where recording_dir comes from UWU_SPEC_RECORDING_DIR env var if present.",
    "- Use source URL from UWU_SPEC_TARGET_URL env var with fallback to the URL below.",
    "- Validate at least one critical user journey and assert deterministic outcomes.",
    "- Print a final line as: UWU_SPEC_RESULT={\"passed\": true|false, \"summary\": \"...\"}",
    "- Exit with code 0 only when passed is true.",
    "- Close context/browser in finally blocks.",
    "Rules:",
    "- Prioritize robust selectors and deterministic assertions.",
    "- Include API/network failure coverage and visible error states.",
    "- Keep it specific to this app and URL.",
    `Target URL: ${sourceUrl}`,
    webContextBlock(webContext),
    "Workspace context:",
    JSON.stringify(compactWorkspaceContext(context), null, 2),
  ].join("\n");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openrouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://uwu-code.local",
      "X-Title": "discoverer-spec",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2500,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "You produce executable Python Playwright scripts for deterministic headless validation.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const message = (errorBody as { error?: { message?: string } })?.error?.message;
    throw new Error(message || `Discoverer spec request failed (${res.status})`);
  }

  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) {
    throw new Error("Discoverer spec generation returned empty content");
  }

  return { spec: content, model };
}

export async function generateWithCli(
  target: "claude" | "opencode",
  project: string,
  context: ReturnType<typeof collectWorkspaceContext>,
  options?: { sourceUrl?: string; spec?: string; webContext?: FetchedWebContext }
): Promise<{ testConfig: DiscovererTestConfig; agentDocs: string; model: string }> {
  const envKeys = readEnvKeys();
  const hasAnyApiKey = ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"].some(
    (key) => !!envKeys[key as keyof typeof envKeys]?.trim()
  );
  if (!hasAnyApiKey) {
    throw new Error(`No API keys configured for ${target} CLI generation. Add keys in Settings > API Keys.`);
  }

  const prompt = discovererCliPrompt(context, options, target);
  writeCliPromptFile(target, project, prompt);
  const candidates = resolveCommandCandidates(target);
  const configuredModel = discovererCliModel(target);
  const cwd = context.workspacePath;
  const runtimeDirs = resolveCliRuntimeDirs(target);
  const xdgConfig = runtimeDirs.xdgConfig;
  const xdgData = runtimeDirs.xdgData;
  if (!fs.existsSync(xdgConfig)) {
    fs.mkdirSync(xdgConfig, { recursive: true });
  }
  if (!fs.existsSync(xdgData)) {
    fs.mkdirSync(xdgData, { recursive: true });
  }

  const envOverrides: Record<string, string> = {
    HOME: runtimeDirs.home,
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
  const cliTimeoutMs = target === "opencode" ? 180_000 : 240_000;
  const wrappedTimeout = target === "opencode";
  for (const command of candidates) {
    const envStrip = target === "opencode"
      ? ["OPENCODE_SERVER_PASSWORD", "OPENCODE_SERVER_USERNAME", "OPENCODE_CLIENT"]
      : [];

    const versionCheck = await runCli(command, ["--version"], cwd, envOverrides, envStrip, 60_000, wrappedTimeout);
    if (versionCheck.code !== 0) {
      const reason = versionCheck.stderr.trim() || versionCheck.stdout.trim() || versionCheck.errorMessage || "no output";
      attemptErrors.push(`${target} command '${command}' is not runnable: ${reason}`);
      continue;
    }

    const variants = target === "claude"
      ? [
          {
            name: "default",
            args: ["--dangerously-skip-permissions", "--model", configuredModel, "-p", prompt],
          },
        ]
      : [
          {
            name: "pure",
            args: [
              "run",
              "--pure",
              "--dir",
              context.workspacePath,
              "--model",
              configuredModel,
              prompt,
            ],
          },
        ];

    for (const variant of variants) {
      const result = await runCli(command, variant.args, cwd, envOverrides, envStrip, cliTimeoutMs, wrappedTimeout);
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

export async function generateSpecWithCli(
  target: "claude" | "opencode",
  project: string,
  sourceUrl: string,
  context: ReturnType<typeof collectWorkspaceContext>,
  webContext: FetchedWebContext,
): Promise<{ spec: string; model: string }> {
  const contextPayload = target === "opencode"
    ? compactWorkspaceContext(context, { runScripts: 8, routeHints: 18, sampledFiles: 40, keyFiles: 4 })
    : compactWorkspaceContext(context);
  const prompt = [
    "You are Discoverer running a Playwright-first implementation pass.",
    "Create ONE runnable Python Playwright script (async API) for the target URL.",
    "Output MUST be raw Python source code only (no markdown, no fences).",
    "Required behavior:",
    "- Use async_playwright and launch Chromium headless.",
    "- Use context = browser.new_context(record_video_dir=recording_dir) where recording_dir comes from UWU_SPEC_RECORDING_DIR env var if present.",
    "- Use source URL from UWU_SPEC_TARGET_URL env var with fallback to the URL below.",
    "- Validate at least one critical user journey and assert deterministic outcomes.",
    "- Print a final line as: UWU_SPEC_RESULT={\"passed\": true|false, \"summary\": \"...\"}",
    "- Exit with code 0 only when passed is true.",
    "- Close context/browser in finally blocks.",
    `Target URL: ${sourceUrl}`,
    webContextBlock(webContext),
    "Workspace context:",
    JSON.stringify(contextPayload, null, 2),
  ].join("\n");

  writeCliPromptFile(target, project, prompt);
  const candidates = resolveCommandCandidates(target);
  const configuredModel = discovererCliModel(target);
  const cwd = context.workspacePath;
  const envKeys = readEnvKeys();
  const hasAnyApiKey = ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"].some(
    (key) => !!envKeys[key as keyof typeof envKeys]?.trim()
  );
  if (!hasAnyApiKey) {
    throw new Error(`No API keys configured for ${target} CLI spec generation. Add keys in Settings > API Keys.`);
  }

  const runtimeDirs = resolveCliRuntimeDirs(target);

  const envOverrides: Record<string, string> = {
    HOME: runtimeDirs.home,
    XDG_CONFIG_HOME: runtimeDirs.xdgConfig,
    XDG_DATA_HOME: runtimeDirs.xdgData,
  };
  if (!fs.existsSync(runtimeDirs.xdgConfig)) {
    fs.mkdirSync(runtimeDirs.xdgConfig, { recursive: true });
  }
  if (!fs.existsSync(runtimeDirs.xdgData)) {
    fs.mkdirSync(runtimeDirs.xdgData, { recursive: true });
  }
  for (const key of ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"] as const) {
    const value = envKeys[key]?.trim();
    if (value) {
      envOverrides[key] = value;
    }
  }

  const attemptErrors: string[] = [];
  const cliTimeoutMs = target === "opencode" ? 180_000 : 240_000;
  const wrappedTimeout = target === "opencode";
  for (const command of candidates) {
    const envStrip = target === "opencode"
      ? ["OPENCODE_SERVER_PASSWORD", "OPENCODE_SERVER_USERNAME", "OPENCODE_CLIENT"]
      : [];

    const versionCheck = await runCli(command, ["--version"], cwd, envOverrides, envStrip, 60_000, wrappedTimeout);
    if (versionCheck.code !== 0) {
      const reason = versionCheck.stderr.trim() || versionCheck.stdout.trim() || versionCheck.errorMessage || "no output";
      attemptErrors.push(`${target} command '${command}' is not runnable: ${reason}`);
      continue;
    }

    const variants = target === "claude"
      ? [
          {
            name: "default",
            args: ["--dangerously-skip-permissions", "--model", configuredModel, "-p", prompt],
          },
        ]
      : [
          {
            name: "pure",
            args: [
              "run",
              "--pure",
              "--dir",
              context.workspacePath,
              "--model",
              configuredModel,
              prompt,
            ],
          },
        ];

    for (const variant of variants) {
      const result = await runCli(command, variant.args, cwd, envOverrides, envStrip, cliTimeoutMs, wrappedTimeout);
      const output = result.stdout.trim() || result.stderr.trim();
      if (result.code !== 0 || !output) {
        const reason = summarizeCliText(output || result.errorMessage || "no output");
        attemptErrors.push(`${target} spec generation failed [${variant.name}]: ${reason}`);
        continue;
      }

      const fenced = output.match(/```(?:python)?\s*([\s\S]*?)```/i);
      const normalizedOutput = (fenced?.[1] ?? output).trim();

      return {
        spec: normalizedOutput,
        model: `cli/${target}/${configuredModel}`,
      };
    }
  }

  throw new Error(trimErrorMessage(attemptErrors.join(" | ") || `${target} spec generation failed`, 900));
}
