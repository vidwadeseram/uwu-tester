import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { inferProjectSlugFromWorkspace, resolveWorkspacePath, safeProjectSlug } from "@/app/lib/discoverer";

type DiscoverTarget = "api" | "claude" | "opencode";
type DiscoverRunStatus = "running" | "completed" | "failed";

interface DiscoverRun {
  run_id: string;
  target: DiscoverTarget;
  project: string;
  workspacePath: string;
  persistTests: boolean;
  persistDocs: boolean;
  testSavePath?: string;
  docsSavePath?: string;
  status: DiscoverRunStatus;
  started_at: string;
  completed_at?: string;
  pid: number;
  exit_code?: number;
  summary?: string;
  log_file: string;
  exit_file: string;
  response_file: string;
  response?: unknown;
}

const REGRESSION_DIR = path.join(process.cwd(), "..", "regression_tests");
const RESULTS_DIR = path.join(REGRESSION_DIR, "results");
const RUNS_DIR = path.join(RESULTS_DIR, "discoverer", "agent_runs");
const MAX_SUMMARY_BYTES = 8192;

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.chmodSync(dir, 0o777);
  } catch (error) {
    void error;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`;
}

function nowIso() {
  return new Date().toISOString();
}

function runMetaFile(runId: string) {
  return path.join(RUNS_DIR, `${runId}.json`);
}

function saveMeta(meta: DiscoverRun) {
  ensureDir(RUNS_DIR);
  fs.writeFileSync(runMetaFile(meta.run_id), JSON.stringify(meta, null, 2));
}

function readMeta(filePath: string): DiscoverRun | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as DiscoverRun;
    if (!parsed.run_id || !parsed.project || !parsed.target) return null;
    return parsed;
  } catch {
    return null;
  }
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

function extractResponse(absPath: string): unknown {
  try {
    if (!fs.existsSync(absPath)) return undefined;
    const raw = fs.readFileSync(absPath, "utf-8").trim();
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const candidate = fenced?.[1] ?? raw;
      const start = candidate.indexOf("{");
      const end = candidate.lastIndexOf("}");
      if (start >= 0 && end > start) {
        return JSON.parse(candidate.slice(start, end + 1));
      }
      return undefined;
    }
  } catch {
    return undefined;
  }
}

function refreshMeta(meta: DiscoverRun): DiscoverRun {
  if (meta.status !== "running") return meta;

  const exitAbs = path.join(RESULTS_DIR, meta.exit_file);
  const logAbs = path.join(RESULTS_DIR, meta.log_file);
  const responseAbs = path.join(RESULTS_DIR, meta.response_file);

  if (fs.existsSync(exitAbs)) {
    const raw = fs.readFileSync(exitAbs, "utf-8").trim();
    const code = Number(raw);
    const response = extractResponse(responseAbs);
    const updated: DiscoverRun = {
      ...meta,
      status: code === 0 ? "completed" : "failed",
      completed_at: nowIso(),
      exit_code: Number.isFinite(code) ? code : 1,
      summary: readLogSummary(logAbs),
      response,
    };
    saveMeta(updated);
    return updated;
  }

  if (!isPidAlive(meta.pid)) {
    const response = extractResponse(responseAbs);
    const updated: DiscoverRun = {
      ...meta,
      status: "failed",
      completed_at: nowIso(),
      exit_code: 1,
      summary: readLogSummary(logAbs),
      response,
    };
    saveMeta(updated);
    return updated;
  }

  return meta;
}

function buildApiPayload(input: {
  workspacePath: string;
  project: string;
  persistTests: boolean;
  persistDocs: boolean;
  testSavePath?: string;
  docsSavePath?: string;
}) {
  const payload: Record<string, unknown> = {
    workspacePath: input.workspacePath,
    project: input.project,
    persistTests: input.persistTests,
    persistDocs: input.persistDocs,
  };
  if (input.testSavePath) payload.testSavePath = input.testSavePath;
  if (input.docsSavePath) payload.docsSavePath = input.docsSavePath;
  return JSON.stringify(payload);
}

function buildCurlCommand(payload: string): string {
  const port = process.env.NEXT_PUBLIC_DASHBOARD_PORT ?? process.env.PORT ?? "3000";
  const secret = process.env.AUTH_SECRET?.trim() ?? "";
  const headers = [`-H 'Content-Type: application/json'`];
  if (secret) headers.push(`-H ${shellQuote(`x-internal-secret: ${secret}`)}`);
  return `curl -sS -X POST http://127.0.0.1:${port}/api/discoverer ${headers.join(" ")} -d ${shellQuote(payload)}`;
}

function buildAgentPrompt(curlCmd: string, input: { project: string; workspacePath: string }) {
  return [
    `You are running Discoverer for project ${input.project}.`,
    `Workspace path: ${input.workspacePath}.`,
    "Run this exact bash command once and output only the JSON response:",
    curlCmd,
  ].join("\n");
}

function buildRunnerCommand(target: DiscoverTarget, input: {
  workspacePath: string;
  project: string;
  persistTests: boolean;
  persistDocs: boolean;
  testSavePath?: string;
  docsSavePath?: string;
}) {
  const payload = buildApiPayload(input);
  const curlCmd = buildCurlCommand(payload);

  if (target === "api") {
    return curlCmd;
  }

  const prompt = buildAgentPrompt(curlCmd, input);
  if (target === "claude") {
    return `cd /home/uwu && claude --dangerously-skip-permissions -p ${shellQuote(prompt)}`;
  }

  const opencodeLookup = [
    "OPENCODE_BIN=\"$(command -v opencode || true)\"",
    "[ -z \"$OPENCODE_BIN\" ] && [ -x /usr/local/bin/opencode ] && OPENCODE_BIN=/usr/local/bin/opencode",
    "[ -z \"$OPENCODE_BIN\" ] && [ -x /opt/homebrew/bin/opencode ] && OPENCODE_BIN=/opt/homebrew/bin/opencode",
    "[ -z \"$OPENCODE_BIN\" ] && [ -x /home/uwu/.local/bin/opencode ] && OPENCODE_BIN=/home/uwu/.local/bin/opencode",
  ].join("; ");

  const runWithOpencode = `cd ${shellQuote(REGRESSION_DIR)} && \"$OPENCODE_BIN\" run --dir ${shellQuote(REGRESSION_DIR)} ${shellQuote(prompt)}`;
  const fallbackToApi = `${curlCmd}`;

  return [
    opencodeLookup,
    "if [ -z \"$OPENCODE_BIN\" ]; then",
    "  echo \"opencode binary not found; falling back to direct Discoverer API\" >&2",
    `  ${fallbackToApi}`,
    "else",
    `  ${runWithOpencode} || { echo \"opencode run failed; falling back to direct Discoverer API\" >&2; ${fallbackToApi}; }`,
    "fi",
  ].join("; ");
}

function spawnBackgroundRun(meta: DiscoverRun) {
  const logAbs = path.join(RESULTS_DIR, meta.log_file);
  const exitAbs = path.join(RESULTS_DIR, meta.exit_file);
  const responseAbs = path.join(RESULTS_DIR, meta.response_file);

  ensureDir(path.dirname(logAbs));
  ensureDir(path.dirname(exitAbs));
  ensureDir(path.dirname(responseAbs));

  const runnerCmd = buildRunnerCommand(meta.target, {
    workspacePath: meta.workspacePath,
    project: meta.project,
    persistTests: meta.persistTests,
    persistDocs: meta.persistDocs,
    testSavePath: meta.testSavePath,
    docsSavePath: meta.docsSavePath,
  });

  const wrapped = `${runnerCmd} > ${shellQuote(responseAbs)} 2> ${shellQuote(logAbs)}; code=$?; if [ -f ${shellQuote(responseAbs)} ]; then cat ${shellQuote(responseAbs)} >> ${shellQuote(logAbs)}; fi; echo $code > ${shellQuote(exitAbs)}`;

  const env = {
    ...process.env,
    HOME: "/home/uwu",
    PATH: `${process.env.PATH ?? ""}:/usr/local/bin:/opt/homebrew/bin:/home/uwu/.local/bin`,
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

  const target = String(body.target ?? "").trim() as DiscoverTarget;
  const workspacePathRaw = String(body.workspacePath ?? "").trim();
  const projectRaw = String(body.project ?? "").trim();
  const persistTests = body.persistTests !== false;
  const persistDocs = body.persistDocs !== false;
  const testSavePath = typeof body.testSavePath === "string" ? body.testSavePath.trim() : "";
  const docsSavePath = typeof body.docsSavePath === "string" ? body.docsSavePath.trim() : "";

  if (target !== "api" && target !== "claude" && target !== "opencode") {
    return NextResponse.json({ error: "Invalid target" }, { status: 400 });
  }

  const workspacePath = resolveWorkspacePath(workspacePathRaw);
  if (!workspacePath) {
    return NextResponse.json({ error: "Invalid workspacePath" }, { status: 400 });
  }

  const project = safeProjectSlug(projectRaw || inferProjectSlugFromWorkspace(workspacePath));
  if (!project) {
    return NextResponse.json({ error: "Invalid project" }, { status: 400 });
  }

  ensureDir(RUNS_DIR);
  const runId = `${new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z")}-${Math.random().toString(36).slice(2, 8)}`;
  const logRelative = path.join("discoverer", "agent_runs", `${runId}.log`).replaceAll("\\", "/");
  const exitRelative = path.join("discoverer", "agent_runs", `${runId}.exit`).replaceAll("\\", "/");
  const responseRelative = path.join("discoverer", "agent_runs", `${runId}.response.json`).replaceAll("\\", "/");

  const meta: DiscoverRun = {
    run_id: runId,
    target,
    project,
    workspacePath,
    persistTests,
    persistDocs,
    testSavePath: testSavePath || undefined,
    docsSavePath: docsSavePath || undefined,
    status: "running",
    started_at: nowIso(),
    pid: 0,
    log_file: logRelative,
    exit_file: exitRelative,
    response_file: responseRelative,
  };

  const pid = spawnBackgroundRun(meta);
  const withPid = { ...meta, pid };
  saveMeta(withPid);

  return NextResponse.json({
    success: true,
    status: "started",
    run_id: runId,
    project,
    target,
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const requestedProject = searchParams.get("project")?.trim() ?? "";

  if (requestedProject && !/^[a-zA-Z0-9_-]+$/.test(requestedProject)) {
    return NextResponse.json({ error: "Invalid project" }, { status: 400 });
  }

  ensureDir(RUNS_DIR);

  const files = fs
    .readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();

  const runs: DiscoverRun[] = [];
  for (const file of files) {
    const meta = readMeta(path.join(RUNS_DIR, file));
    if (!meta) continue;
    if (requestedProject && meta.project !== requestedProject) continue;
    runs.push(refreshMeta(meta));
  }

  runs.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));

  return NextResponse.json({
    runs: runs.slice(0, 30),
    running: runs.some((run) => run.status === "running"),
  });
}
