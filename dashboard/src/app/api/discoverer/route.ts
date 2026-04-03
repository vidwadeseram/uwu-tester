import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import {
  allowedWorkspaceRoots,
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
const DISCOVERER_SPECS_DIR = path.join(REGRESSION_DIR, "specs");
const DISCOVERER_PROMPT_DIR = path.join(REGRESSION_DIR, "results", "discoverer", "cli_prompts");

interface DiscovererRequest {
  workspacePath?: string;
  project?: string;
  sourceUrl?: string;
  persistTests?: boolean;
  persistDocs?: boolean;
  specSavePath?: string;
  testSavePath?: string;
  docsSavePath?: string;
  generationTarget?: "api" | "claude" | "opencode";
}

interface DeterministicGeneration {
  spec: string;
  testConfig: DiscovererTestConfig;
  agentDocs: string;
  specModel: string;
  generationModel: string;
  warning: string;
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

interface FetchedWebContext {
  finalUrl: string;
  status: number;
  title: string;
  description: string;
  headings: string[];
  links: string[];
  excerpt: string;
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
  const withoutAnsi = raw.replace(new RegExp("\\u001b\\[[0-9;]*m", "g"), "");
  const compact = withoutAnsi.replace(/\s+/g, " ").trim();
  if (!compact) return "Discoverer generation failed";
  return compact.length > maxChars ? `${compact.slice(0, maxChars)}…` : compact;
}

function normalizeSourceUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function discovererApiModel(): string {
  const settings = readSettings();
  return settings.models?.discoverer_api ?? settings.models?.discoverer ?? "openrouter/free";
}

function discovererCliModel(target: "claude" | "opencode"): string {
  const settings = readSettings();
  if (target === "claude") {
    return settings.models?.discoverer_claude ?? "sonnet";
  }
  return settings.models?.discoverer_opencode ?? "opencode/qwen3.6-plus-free";
}

function writeCliPromptFile(target: "claude" | "opencode", project: string, prompt: string): string {
  ensureDir(DISCOVERER_PROMPT_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z");
  const token = Math.random().toString(36).slice(2, 8);
  const filePath = path.join(DISCOVERER_PROMPT_DIR, `${target}-${project}-${stamp}-${token}.txt`);
  fs.writeFileSync(filePath, prompt);
  return filePath;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFirstMatch(html: string, regex: RegExp): string {
  const match = html.match(regex);
  if (!match?.[1]) return "";
  return stripTags(match[1]).slice(0, 240);
}

function extractHeadings(html: string): string[] {
  const headings: string[] = [];
  const regex = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let match = regex.exec(html);
  while (match && headings.length < 12) {
    const value = stripTags(match[1]);
    if (value) headings.push(value.slice(0, 180));
    match = regex.exec(html);
  }
  return headings;
}

function extractLinks(html: string): string[] {
  const links: string[] = [];
  const regex = /<a[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match = regex.exec(html);
  while (match && links.length < 20) {
    const href = (match[1] ?? "").trim();
    if (href) links.push(href.slice(0, 280));
    match = regex.exec(html);
  }
  return Array.from(new Set(links));
}

async function fetchWebContext(sourceUrl: string): Promise<FetchedWebContext> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(sourceUrl, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "user-agent": "uwu-code-discoverer/1.0",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    const html = await res.text();
    if (!html.trim()) {
      throw new Error("URL returned empty content");
    }

    const title = extractFirstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const description = extractFirstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i);
    const excerpt = stripTags(html).slice(0, 3000);

    return {
      finalUrl: res.url,
      status: res.status,
      title,
      description,
      headings: extractHeadings(html),
      links: extractLinks(html),
      excerpt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to fetch source URL content: ${trimErrorMessage(message, 280)}`);
  } finally {
    clearTimeout(timeout);
  }
}

function webContextBlock(web: FetchedWebContext): string {
  return [
    "Fetched web URL context:",
    JSON.stringify(
      {
        finalUrl: web.finalUrl,
        status: web.status,
        title: web.title,
        description: web.description,
        headings: web.headings,
        links: web.links,
        excerpt: web.excerpt,
      },
      null,
      2,
    ),
  ].join("\n");
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

function compactWorkspaceContext(
  ctx: ReturnType<typeof collectWorkspaceContext>,
  limits?: {
    runScripts?: number;
    routeHints?: number;
    sampledFiles?: number;
    keyFiles?: number;
  }
) {
  const runScriptsLimit = limits?.runScripts ?? 20;
  const routeHintsLimit = limits?.routeHints ?? 40;
  const sampledFilesLimit = limits?.sampledFiles ?? 160;
  const keyFilesLimit = limits?.keyFiles ?? 12;
  return {
    workspaceName: ctx.workspaceName,
    workspacePath: ctx.workspacePath,
    fileCount: ctx.fileCount,
    stackHints: ctx.stackHints,
    runScripts: ctx.runScripts.slice(0, runScriptsLimit),
    routeHints: ctx.routeHints.slice(0, routeHintsLimit),
    sampledFiles: ctx.sampledFiles.slice(0, sampledFilesLimit),
    keyFiles: ctx.keyFiles.slice(0, keyFilesLimit),
  };
}

function toCoveragePath(raw: string, sourceUrl: string): string | null {
  const input = (raw || "").trim();
  if (!input) return null;

  let pathname = "";
  if (input.startsWith("http://") || input.startsWith("https://")) {
    try {
      const parsed = new URL(input);
      const base = new URL(sourceUrl || "http://localhost:3000");
      if (parsed.origin !== base.origin) return null;
      pathname = parsed.pathname || "/";
    } catch {
      return null;
    }
  } else if (input.startsWith("/")) {
    pathname = input;
  } else {
    return null;
  }

  const normalized = pathname.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  const lowered = normalized.toLowerCase();
  if (lowered.startsWith("/api/")) return null;
  if (lowered === "/api") return null;
  if (/(\.png|\.jpg|\.jpeg|\.gif|\.svg|\.webp|\.ico|\.css|\.js|\.map|\.woff|\.woff2|\.ttf|\.otf|\.json)$/i.test(lowered)) {
    return null;
  }
  if (lowered.includes("logout") || lowered.includes("signout")) return null;
  return normalized;
}

function buildCoverageRoutes(
  sourceUrl: string,
  context: ReturnType<typeof collectWorkspaceContext>,
  web: FetchedWebContext,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const normalized = toCoveragePath(value, sourceUrl);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };

  add("/");
  for (const route of context.routeHints) add(route);
  for (const link of web.links) add(link);
  for (const authRoute of ["/login", "/signin", "/signup", "/forgot-password", "/verify", "/otp"]) add(authRoute);

  return out.slice(0, 28);
}

function deterministicSpec(sourceUrl: string, coverageRoutes: string[]): string {
  const safeUrl = sourceUrl || "http://localhost:3000";
  const plannedRoutesJson = JSON.stringify(coverageRoutes);
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
    "      if (r && r.status() < 500) reachable += 1;",
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

function deterministicConfig(
  project: string,
  sourceUrl: string,
  context: ReturnType<typeof collectWorkspaceContext>,
  web: FetchedWebContext,
): DeterministicGeneration {
  const coverageRoutes = buildCoverageRoutes(sourceUrl, context, web);
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
    `Planned route coverage (${coverageRoutes.length}): ${coverageRoutes.join(", ")}`,
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

async function generateWithModel(
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

async function generateSpecWithModel(
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

function runCli(
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

function discovererCliPrompt(
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

function resolveCliRuntimeDirs(target: "claude" | "opencode"): {
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
    } catch {}
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

async function generateWithCli(
  target: "claude" | "opencode",
  project: string,
  context: ReturnType<typeof collectWorkspaceContext>,
  options?: { sourceUrl?: string; spec?: string; webContext?: FetchedWebContext }
): Promise<{ testConfig: DiscovererTestConfig; agentDocs: string; model: string }> {
  const prompt = discovererCliPrompt(context, options, target);
  const promptFile = writeCliPromptFile(target, project, prompt);
  const candidates = resolveCommandCandidates(target);
  const configuredModel = discovererCliModel(target);
  const cwd = context.workspacePath;
  const envKeys = readEnvKeys();
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
  const cliTimeoutMs = target === "opencode" ? 600_000 : 240_000;
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

async function generateSpecWithCli(
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

  const promptFile = writeCliPromptFile(target, project, prompt);
  const candidates = resolveCommandCandidates(target);
  const configuredModel = discovererCliModel(target);
  const cwd = context.workspacePath;
  const envKeys = readEnvKeys();
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
  const cliTimeoutMs = target === "opencode" ? 600_000 : 240_000;
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
  if (parsed.sourceUrl !== undefined && typeof parsed.sourceUrl !== "string") {
    return NextResponse.json({ error: "sourceUrl must be a string" }, { status: 400 });
  }
  if (parsed.persistTests !== undefined && typeof parsed.persistTests !== "boolean") {
    return NextResponse.json({ error: "persistTests must be a boolean" }, { status: 400 });
  }
  if (parsed.persistDocs !== undefined && typeof parsed.persistDocs !== "boolean") {
    return NextResponse.json({ error: "persistDocs must be a boolean" }, { status: 400 });
  }
  if (parsed.specSavePath !== undefined && typeof parsed.specSavePath !== "string") {
    return NextResponse.json({ error: "specSavePath must be a string" }, { status: 400 });
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

  const sourceUrl = normalizeSourceUrl(parsed.sourceUrl ?? "");
  if (!sourceUrl) {
    return NextResponse.json({ error: "sourceUrl (http/https) is required for Discoverer" }, { status: 400 });
  }

  const persistTests = parsed.persistTests !== false;
  const persistDocs = parsed.persistDocs !== false;
  const specSavePath = (parsed.specSavePath ?? "").trim();
  const testSavePath = (parsed.testSavePath ?? "").trim();
  const docsSavePath = (parsed.docsSavePath ?? "").trim();
  const generationTarget = parsed.generationTarget ?? "api";
  const resolvedSpecSavePath = resolvePersistPath(specSavePath, normalizedWorkspace);
  const resolvedTestSavePath = resolvePersistPath(testSavePath, normalizedWorkspace);
  const resolvedDocsSavePath = resolvePersistPath(docsSavePath, normalizedWorkspace);

  if (generationTarget !== "api" && generationTarget !== "claude" && generationTarget !== "opencode") {
    return NextResponse.json({ error: "generationTarget must be api|claude|opencode" }, { status: 400 });
  }

  if (specSavePath && !resolvedSpecSavePath) {
    return NextResponse.json(
      { error: `specSavePath must be under allowed roots: ${allowedWorkspaceRoots().join(", ")}` },
      { status: 400 }
    );
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
  let fetchedWeb: FetchedWebContext;
  try {
    fetchedWeb = await fetchWebContext(sourceUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Discoverer URL fetch failed: ${trimErrorMessage(message, 900)}` }, { status: 503 });
  }

  let generatedTestConfig: DiscovererTestConfig;
  let agentDocs: string;
  let generatedSpec = "";
  let specModel = "";
  let generationModel = "";
  let generationWarning = "";

  try {
    const specGenerated = generationTarget === "api"
      ? await generateSpecWithModel(project, sourceUrl, context, fetchedWeb)
      : await generateSpecWithCli(generationTarget, project, sourceUrl, context, fetchedWeb);
    generatedSpec = specGenerated.spec;
    specModel = specGenerated.model;
  } catch (error) {
    const primaryMessage = error instanceof Error ? error.message : "Discoverer spec generation failed";
    const deterministic = deterministicConfig(project, sourceUrl, context, fetchedWeb);
    generatedSpec = deterministic.spec;
    specModel = deterministic.specModel;
    generationWarning = generationWarning
      ? `${generationWarning} | ${deterministic.warning}`
      : deterministic.warning;
  }

  try {
    const generated = generationTarget === "api"
      ? await generateWithModel(project, context, { sourceUrl, spec: generatedSpec, webContext: fetchedWeb })
      : await generateWithCli(generationTarget, project, context, { sourceUrl, spec: generatedSpec, webContext: fetchedWeb });
    generatedTestConfig = generated.testConfig;
    agentDocs = generated.agentDocs;
    generationModel = generated.model;
  } catch (error) {
    const primaryMessage = error instanceof Error ? error.message : "Discoverer generation failed";
    const deterministic = deterministicConfig(project, sourceUrl, context, fetchedWeb);
    generatedTestConfig = deterministic.testConfig;
    agentDocs = deterministic.agentDocs;
    generationModel = deterministic.generationModel;
    generationWarning = generationWarning
      ? `${generationWarning} | ${deterministic.warning}`
      : deterministic.warning;
  }

  let effectiveTestConfig = generatedTestConfig;

  let specFile = "";
  let testCasesFile = "";
  let knowledgeFile = "";
  let specMode: "created" | "updated" | "unchanged" = "unchanged";
  let testsMode: "created" | "merged" | "unchanged" | "skipped" = "skipped";
  let docsMode: "created" | "appended" | "unchanged" | "skipped" = "skipped";
  let testsMerge: DiscovererMergeReport | undefined;

  const specSaveDir = resolvedSpecSavePath || DISCOVERER_SPECS_DIR;
  const targetSpecFile = path.join(specSaveDir, `${project}.spec.ts`);

  const targetTestsFile = persistTests
    ? path.join(resolvedTestSavePath || TEST_CASES_DIR, `${project}.json`)
    : "";
  const targetDocsFile = persistDocs
    ? resolveKnowledgeFilePath(project, resolvedDocsSavePath || undefined)
    : "";

  const specBeforeContent = readOptionalFileText(targetSpecFile);
  const testsBeforeContent = targetTestsFile ? readOptionalFileText(targetTestsFile) : null;
  const docsBeforeContent = targetDocsFile ? readOptionalFileText(targetDocsFile) : null;

  if (!fs.existsSync(specSaveDir)) {
    fs.mkdirSync(specSaveDir, { recursive: true });
  }
  specFile = targetSpecFile;
  fs.writeFileSync(specFile, generatedSpec);
  specMode = specBeforeContent === null ? "created" : specBeforeContent === generatedSpec ? "unchanged" : "updated";

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
    spec: specFile
      ? { path: specFile, beforeContent: specBeforeContent }
      : undefined,
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
    sourceUrl,
    testConfig: effectiveTestConfig,
    spec: generatedSpec,
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
      specFile: specFile || undefined,
      specMode,
      testCasesFile: testCasesFile || undefined,
      knowledgeFile: knowledgeFile || undefined,
      testsMode,
      docsMode,
      testsMerge,
      generationModel,
      specModel,
      generationWarning: generationWarning || undefined,
      historyId: historyEntry?.id,
    },
  });
}
