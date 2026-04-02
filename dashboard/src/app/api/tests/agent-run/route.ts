import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { getProjectPaths, getReadableProjectPaths } from "@/app/lib/tests-paths";
import { readSettings } from "@/app/lib/settings";

type AgentTarget = "claude" | "opencode";

type AgentRunStatus = "running" | "completed" | "failed";

interface AgentRun {
  run_id: string;
  project: string;
  target: AgentTarget;
  status: AgentRunStatus;
  started_at: string;
  completed_at?: string;
  workflow_ids: string[];
  case_ids: string[];
  pid: number;
  exit_code?: number;
  log_file: string;
  exit_file: string;
  summary?: string;
}

const REGRESSION_DIR = path.join(process.cwd(), "..", "regression_tests");
const MAX_SUMMARY_BYTES = 8192;
const DEFAULT_TESTS_CLAUDE_MODEL = "sonnet";
const DEFAULT_TESTS_OPENCODE_MODEL = "opencode/qwen3.6-plus-free";
const FALLBACK_OPENCODE_MODELS = [
  "opencode/big-pickle",
  "opencode/qwen3.6-plus-free",
  "opencode/gpt-5-nano",
];

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  try { fs.chmodSync(dir, 0o777); } catch { /* best-effort */ }
}

function projectRunsDir(project: string) {
  return getReadableProjectPaths(project).agentRunsDir;
}

function ensureProjectResultDirs(project: string) {
  const projectDir = getProjectPaths(project).projectResultsDir;
  ensureDir(projectDir);
  ensureDir(path.join(projectDir, "recordings"));
  ensureDir(path.join(projectDir, "recordings", "manual"));
  ensureDir(path.join(projectDir, "agent_runs"));
}

function runMetaFile(project: string, runId: string) {
  return path.join(projectRunsDir(project), `${runId}.json`);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function nowIso() {
  return new Date().toISOString();
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLogSummary(absPath: string): string {
  try {
    if (!fs.existsSync(absPath)) return "";
    const stat = fs.statSync(absPath);
    const start = Math.max(0, stat.size - MAX_SUMMARY_BYTES);
    const fd = fs.openSync(absPath, "r");
    const len = stat.size - start;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    fs.closeSync(fd);
    return buf.toString("utf-8");
  } catch {
    return "";
  }
}

function readMeta(filePath: string): AgentRun | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as AgentRun;
    if (!parsed.run_id || !parsed.project || !parsed.target) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveMeta(meta: AgentRun) {
  ensureDir(path.dirname(runMetaFile(meta.project, meta.run_id)));
  fs.writeFileSync(runMetaFile(meta.project, meta.run_id), JSON.stringify(meta, null, 2));
}

function refreshMeta(meta: AgentRun): AgentRun {
  if (meta.status !== "running") return meta;

  const resultsDir = getReadableProjectPaths(meta.project).resultsDir;
  const exitAbs = path.join(resultsDir, meta.exit_file);
  const logAbs = path.join(resultsDir, meta.log_file);

  if (fs.existsSync(exitAbs)) {
    const raw = fs.readFileSync(exitAbs, "utf-8").trim();
    const code = Number(raw);
    const updated: AgentRun = {
      ...meta,
      status: code === 0 ? "completed" : "failed",
      completed_at: nowIso(),
      exit_code: Number.isFinite(code) ? code : 1,
      summary: readLogSummary(logAbs),
    };
    saveMeta(updated);
    return updated;
  }

  const logSummary = readLogSummary(logAbs);
  if (meta.case_ids.length > 0 && logSummary.length > 0) {
    const finalResultCount = (logSummary.match(/=== FINAL RESULT ===/g) ?? []).length;
    if (finalResultCount >= meta.case_ids.length) {
      try {
        process.kill(meta.pid, "SIGTERM");
      } catch {
      }

      const hasFailureStatus = /"status"\s*:\s*"(FAIL|FAILED|ERROR)"/i.test(logSummary);
      const hasBrowserErrors = /"browser_errors"\s*:\s*\[\s*[^\]]+/i.test(logSummary);
      const failed = hasFailureStatus || hasBrowserErrors;

      const updated: AgentRun = {
        ...meta,
        status: failed ? "failed" : "completed",
        completed_at: nowIso(),
        exit_code: failed ? 1 : 0,
        summary: logSummary,
      };
      saveMeta(updated);
      return updated;
    }
  }

  if (!isPidAlive(meta.pid)) {
    const updated: AgentRun = {
      ...meta,
      status: "failed",
      completed_at: nowIso(),
      exit_code: 1,
      summary: readLogSummary(logAbs),
    };
    saveMeta(updated);
    return updated;
  }

  return meta;
}

function parseSelection(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => /^[a-zA-Z0-9_-]+$/.test(v));
}

function loadProjectEnv(project: string): Record<string, string> {
  const file = getReadableProjectPaths(project).envFile;
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key !== "string") continue;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        out[key] = String(value);
      }
    }
    return out;
  } catch {
    return {};
  }
}

function resolveTestsClaudeModel(): string {
  const settings = readSettings();
  const fromSettings = settings.models?.tests_claude?.trim();
  const fromEnv = process.env.CLAUDE_TEST_MODEL?.trim();
  return fromSettings || fromEnv || DEFAULT_TESTS_CLAUDE_MODEL;
}

function resolveTestsOpencodeModel(): string {
  const settings = readSettings();
  const fromSettings = settings.models?.tests_opencode?.trim();
  const legacy = settings.models?.tests?.trim();
  const fromEnv = process.env.OPENCODE_TEST_MODEL?.trim();
  return fromSettings || fromEnv || legacy || DEFAULT_TESTS_OPENCODE_MODEL;
}

function buildScopeInstruction(workflowIds: string[], caseIds: string[]): string {
  if (workflowIds.length > 0) {
    return `Run only workflows: ${workflowIds.join(", ")}. Also include any required case dependencies.`;
  }
  if (caseIds.length > 0) {
    return `Run only case IDs: ${caseIds.join(", ")}. Also include any required case dependencies.`;
  }
  return "Run all enabled test cases.";
}

function buildPrompt(
  project: string,
  runId: string,
  workflowIds: string[],
  caseIds: string[],
  otpConfig: { instruction: string; tmuxSession: string; tmuxWindow: string }
): string {
  const scope = buildScopeInstruction(workflowIds, caseIds);
  const otpHintParts = [
    otpConfig.tmuxSession ? `session=${otpConfig.tmuxSession}` : "",
    otpConfig.tmuxWindow ? `tab/window=${otpConfig.tmuxWindow}` : "",
  ].filter(Boolean);
  const otpHint = otpHintParts.length > 0 ? otpHintParts.join(", ") : "no tmux target configured";
  const otpInstruction = otpConfig.instruction.trim()
    ? otpConfig.instruction.trim()
    : "Use configured project OTP source settings; if unavailable, request OTP instruction from user and retry.";

  return [
    `Read the test cases for project '${project}' from MCP resource uwu://projects/${project}/cases.`,
    scope,
    `Use this exact run_id for all saved output: ${runId}.`,
    "Do NOT run test_runner.py and do NOT call any run_tests tool.",
    "Execute cases yourself as a browser agent using Playwright from /opt/vps-dashboard/regression_tests/.venv/bin/python.",
    "IMPORTANT browser interaction rules:",
    "(a) For checkboxes always use locator.check() — never .click() or .evaluate('e => e.click()') as the app is React-based and requires proper change events.",
    "(a.1) In allinonepos signup, you MUST accept this exact checkbox text before submit: 'I agree to Marx Merchant Portal Terms of Use and have read and acknowledged Privacy Policy'. Verify checkbox is checked (is_checked=true). If not checked or submit is blocked by terms validation, mark FAIL.",
    "(b) After any form submission wait at least 3 seconds before checking the result.",
    "(c) For this app, /signup/ is the registration page and /signup-verification/ is the OTP page. Registration is SUCCESS only with explicit signal: redirected to /signup-verification/, OR clear success toast/message, OR explicit account-already-exists message.",
    "(c.2) If submit completes but URL remains on /signup/ without explicit success signal, treat as FAIL.",
    "(c.1) Any visible validation/error text (including terms/privacy required, invalid credentials, request failed, or exception traces) means FAIL.",
    "(e) Capture browser errors during each case: console errors, page exceptions, failed requests, and HTTP >= 400 responses.",
    "(f) Include browser errors in each case detail JSON under key 'browser_errors'. If browser_errors is non-empty, that case MUST be FAIL (unless the test explicitly expects errors).",
    "(g) Before each case, clear localStorage, sessionStorage, and cookies for the active origin to avoid stale-state false positives.",
    `(h) For OTP retrieval, call MCP tool 'get_otp' with project='${project}' and instruction='${otpInstruction}'. Current source hint: ${otpHint}.`,
    "(h.1) Never hardcode OTP sources in your logic; always use get_otp tool output or explicit user-provided instruction.",
    "(i) Execute immediately in this run. Do NOT ask for confirmation, approval, or extra setup inputs.",
    "(j) Never ask for BASE_URL or placeholder values. Use resolved case tasks as provided.",
    "(k) If MCP resource read fails, load cases directly from $UWU_TEST_CASES_DIR/<project>.json and continue.",
    "(l) Do NOT write or modify repository files. Only execute browser actions and report results.",
    "(d) Keep recording running for at least 20 extra seconds after each case reaches its final assertion before closing the page/context.",
    `For every case, capture a recording and keep artifacts under results/${project}/recordings/manual/${runId}/<case_id>/.`,
    `After all cases, call save_results tool with full details and set run_id to ${runId}. Include recording path for each case using a path relative to results root (example: ${project}/recordings/manual/${runId}/web_login/video.webm). Do NOT prefix recording paths with 'results/'.`,
    "If save_results fails, retry once with the same payload before finishing.",
    "If save_results fails for any reason, still print final report lines exactly in this format: - `<case_id>`: PASS|FAIL|SKIPPED. Recording: `<absolute_or_results_relative_path>`.",
    "Finally return a detailed pass/fail report for each case.",
  ].join(" ");
}

function buildAgentShellCommand(
  target: AgentTarget,
  prompt: string,
  models: { claude: string; opencode: string }
): string {
  if (target === "claude") {
    return [
      "cd /home/uwu",
      `CLAUDE_MODEL=${shellQuote(models.claude)}`,
      `claude --dangerously-skip-permissions --model ${shellQuote(models.claude)} -p ${shellQuote(prompt)}`,
    ].join(" && ");
  }
  const opencodeLookup = [
    "OPENCODE_BIN=\"$(command -v opencode || true)\"",
    "[ -z \"$OPENCODE_BIN\" ] && [ -x /usr/local/bin/opencode ] && OPENCODE_BIN=/usr/local/bin/opencode",
    "[ -z \"$OPENCODE_BIN\" ] && [ -x /home/uwu/.local/bin/opencode ] && OPENCODE_BIN=/home/uwu/.local/bin/opencode",
  ].join("; ");

  const fallbackModels = FALLBACK_OPENCODE_MODELS.map((model) => shellQuote(model)).join(" ");

  const runOpencode = [
    `cd ${shellQuote(REGRESSION_DIR)}`,
    `REQUESTED_MODEL=${shellQuote(models.opencode)}`,
    `FALLBACK_MODELS=${shellQuote(fallbackModels)}`,
    "AVAILABLE_MODELS=\"$($OPENCODE_BIN models 2>/dev/null || true)\"",
    "SELECTED_MODEL=\"$REQUESTED_MODEL\"",
    "if ! printf '%s\\n' \"$AVAILABLE_MODELS\" | grep -Fxq \"$REQUESTED_MODEL\"; then SELECTED_MODEL=\"\"; fi",
    "if [ -z \"$SELECTED_MODEL\" ]; then for CANDIDATE in $FALLBACK_MODELS; do if printf '%s\\n' \"$AVAILABLE_MODELS\" | grep -Fxq \"$CANDIDATE\"; then SELECTED_MODEL=\"$CANDIDATE\"; break; fi; done; fi",
    "if [ -z \"$SELECTED_MODEL\" ]; then SELECTED_MODEL=\"$(printf '%s\\n' \"$AVAILABLE_MODELS\" | head -n 1)\"; fi",
    `if command -v timeout >/dev/null 2>&1; then timeout 18m "$OPENCODE_BIN" run --dir ${shellQuote(REGRESSION_DIR)} --model "$SELECTED_MODEL" ${shellQuote(prompt)}; else "$OPENCODE_BIN" run --dir ${shellQuote(REGRESSION_DIR)} --model "$SELECTED_MODEL" ${shellQuote(prompt)}; fi`,
  ].join(" && ");
  return `${opencodeLookup}; if [ -n "$OPENCODE_BIN" ]; then ${runOpencode}; else echo "opencode not found" >&2; exit 1; fi`;
}

function spawnBackgroundRun(meta: AgentRun, prompt: string) {
  const projectPaths = getProjectPaths(meta.project);
  const logAbs = path.join(projectPaths.resultsDir, meta.log_file);
  const exitAbs = path.join(projectPaths.resultsDir, meta.exit_file);
  ensureDir(path.dirname(logAbs));

  const modelSelection = {
    claude: resolveTestsClaudeModel(),
    opencode: resolveTestsOpencodeModel(),
  };
  const agentCmd = buildAgentShellCommand(meta.target, prompt, modelSelection);
  const wrapped = `${agentCmd} > ${shellQuote(logAbs)} 2>&1; code=$?; echo $code > ${shellQuote(exitAbs)}`;

  const env = {
    ...process.env,
    HOME: "/home/uwu",
    PATH: `${process.env.PATH ?? ""}:/usr/local/bin:/home/uwu/.local/bin`,
    UWU_TEST_CASES_DIR: projectPaths.testCasesDir,
    UWU_RESULTS_DIR: projectPaths.resultsDir,
  };

  const canSetUser = typeof process.getuid === "function" && process.getuid() === 0;
  const child = canSetUser
    ? spawn("sudo", ["-u", "uwu", "bash", "-lc", wrapped], {
        cwd: REGRESSION_DIR,
        env,
        detached: true,
        stdio: "ignore",
      })
    : spawn("bash", ["-lc", wrapped], {
        cwd: REGRESSION_DIR,
        env,
        detached: true,
        stdio: "ignore",
      });

  child.on("error", (err) => {
    try { fs.writeFileSync(logAbs, `spawn error: ${err.message}\n`); } catch { /* best-effort */ }
    try { fs.writeFileSync(exitAbs, "1"); } catch { /* best-effort */ }
  });

  child.unref();
  return child.pid ?? 0;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const project = String(body.project ?? "").trim();
  const target = String(body.target ?? "").trim() as AgentTarget;
  const workflowIds = parseSelection(body.workflow_ids);
  const caseIds = parseSelection(body.case_ids);

  if (!/^[a-zA-Z0-9_-]+$/.test(project)) {
    return NextResponse.json({ error: "Invalid project" }, { status: 400 });
  }
  if (target !== "claude" && target !== "opencode") {
    return NextResponse.json({ error: "Invalid target" }, { status: 400 });
  }

  const runId = `${new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z")}-${Math.random().toString(36).slice(2, 8)}`;
  ensureProjectResultDirs(project);
  const runsDir = projectRunsDir(project);
  ensureDir(runsDir);

  const logRelative = path.join(project, "agent_runs", `${runId}.log`).replaceAll("\\", "/");
  const exitRelative = path.join(project, "agent_runs", `${runId}.exit`).replaceAll("\\", "/");

  const meta: AgentRun = {
    run_id: runId,
    project,
    target,
    status: "running",
    started_at: nowIso(),
    workflow_ids: workflowIds,
    case_ids: caseIds,
    pid: 0,
    log_file: logRelative,
    exit_file: exitRelative,
  };

  const env = loadProjectEnv(project);
  const otpConfig = {
    instruction: String(env.OTP_FETCH_INSTRUCTION ?? ""),
    tmuxSession: String(env.OTP_TMUX_SESSION ?? env.OTP_TMUX_TARGET ?? ""),
    tmuxWindow: String(env.OTP_TMUX_WINDOW ?? ""),
  };
  const prompt = buildPrompt(project, runId, workflowIds, caseIds, otpConfig);
  const pid = spawnBackgroundRun(meta, prompt);
  const withPid = { ...meta, pid };
  saveMeta(withPid);

  return NextResponse.json({
    success: true,
    status: "started",
    run_id: runId,
    project,
    target,
    workflow_ids: workflowIds,
    case_ids: caseIds,
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const requestedProject = searchParams.get("project")?.trim() ?? "";

  if (requestedProject && !/^[a-zA-Z0-9_-]+$/.test(requestedProject)) {
    return NextResponse.json({ error: "Invalid project" }, { status: 400 });
  }

  ensureDir(path.join(REGRESSION_DIR, "results"));

  const projects = requestedProject
    ? [requestedProject]
    : fs
        .readdirSync(path.join(REGRESSION_DIR, "results"), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

  const runs: AgentRun[] = [];

  for (const project of projects) {
    const runsDir = projectRunsDir(project);
    if (!fs.existsSync(runsDir)) continue;

    const files = fs
      .readdirSync(runsDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();

    for (const file of files) {
      const meta = readMeta(path.join(runsDir, file));
      if (!meta) continue;
      runs.push(refreshMeta(meta));
    }
  }

  runs.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));

  return NextResponse.json({
    runs: runs.slice(0, 30),
    running: runs.some((r) => r.status === "running"),
  });
}
