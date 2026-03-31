import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

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
const RESULTS_DIR = path.join(REGRESSION_DIR, "results");
const MAX_SUMMARY_BYTES = 8192;

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  try { fs.chmodSync(dir, 0o777); } catch { /* best-effort */ }
}

function projectRunsDir(project: string) {
  return path.join(RESULTS_DIR, project, "agent_runs");
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

  const exitAbs = path.join(RESULTS_DIR, meta.exit_file);
  const logAbs = path.join(RESULTS_DIR, meta.log_file);

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

function buildScopeInstruction(workflowIds: string[], caseIds: string[]): string {
  if (workflowIds.length > 0) {
    return `Run only workflows: ${workflowIds.join(", ")}. Also include any required case dependencies.`;
  }
  if (caseIds.length > 0) {
    return `Run only case IDs: ${caseIds.join(", ")}. Also include any required case dependencies.`;
  }
  return "Run all enabled test cases.";
}

function buildPrompt(project: string, workflowIds: string[], caseIds: string[]): string {
  const scope = buildScopeInstruction(workflowIds, caseIds);
  return [
    `Read the test cases for project '${project}' from MCP resource uwu://projects/${project}/cases.`,
    scope,
    "Do NOT run test_runner.py and do NOT call any run_tests tool.",
    "Execute cases yourself as a browser agent using Playwright from /opt/vps-dashboard/regression_tests/.venv/bin/python.",
    "For every case, capture a recording and keep artifacts under results/<project>/recordings/manual/<run_id>/<case_id>/.",
    "After all cases, call save_results tool with full details and include recording path for each case.",
    "Finally return a detailed pass/fail report for each case.",
  ].join(" ");
}

function buildAgentShellCommand(target: AgentTarget, prompt: string): string {
  if (target === "claude") {
    return `cd /home/uwu && claude --dangerously-skip-permissions -p ${shellQuote(prompt)}`;
  }
  return `cd ${shellQuote(REGRESSION_DIR)} && opencode run --dir ${shellQuote(REGRESSION_DIR)} ${shellQuote(prompt)}`;
}

function spawnBackgroundRun(meta: AgentRun, prompt: string) {
  const logAbs = path.join(RESULTS_DIR, meta.log_file);
  const exitAbs = path.join(RESULTS_DIR, meta.exit_file);
  ensureDir(path.dirname(logAbs));

  const agentCmd = buildAgentShellCommand(meta.target, prompt);
  const wrapped = `${agentCmd} > ${shellQuote(logAbs)} 2>&1; code=$?; echo $code > ${shellQuote(exitAbs)}`;

  const child = spawn("sudo", ["-u", "uwu", "bash", "-lc", wrapped], {
    cwd: REGRESSION_DIR,
    env: process.env,
    detached: true,
    stdio: "ignore",
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

  const prompt = buildPrompt(project, workflowIds, caseIds);
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

  ensureDir(RESULTS_DIR);

  const projects = requestedProject
    ? [requestedProject]
    : fs
        .readdirSync(RESULTS_DIR, { withFileTypes: true })
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
