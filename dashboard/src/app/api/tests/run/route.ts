import { NextRequest, NextResponse } from "next/server";
import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";

const REGRESSION_DIR = path.join(process.cwd(), "..", "regression_tests");
const RESULTS_DIR = path.join(REGRESSION_DIR, "results");
const TEST_CASES_DIR = path.join(REGRESSION_DIR, "test_cases");

function loadProjectEnv(project: string): Record<string, string> {
  const envFile = path.join(TEST_CASES_DIR, `${project}.env.json`);
  try {
    return fs.existsSync(envFile) ? JSON.parse(fs.readFileSync(envFile, "utf-8")) : {};
  } catch {
    return {};
  }
}

/** Resolve the uv binary — handles systemd not having ~/.local/bin in PATH */
function findUv(): string {
  const candidates = [
    "/usr/local/bin/uv",
    "/root/.local/bin/uv",
    "/root/.cargo/bin/uv",
    "/home/ubuntu/.local/bin/uv",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  try {
    return execSync("which uv", { encoding: "utf-8" }).trim();
  } catch {
    return "uv";
  }
}

function runningFile(project: string) {
  return path.join(RESULTS_DIR, project, "running.json");
}

function parseSelection(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => /^[a-zA-Z0-9_-]+$/.test(v));
}

/** Check if the PID stored in the lock file is actually still running */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = just check existence
    return true;
  } catch {
    return false;
  }
}

function isActuallyRunning(lockFile: string): boolean {
  if (!fs.existsSync(lockFile)) return false;
  try {
    const info = JSON.parse(fs.readFileSync(lockFile, "utf-8"));
    if (!info.pid) return false; // old-style lock without pid — treat as stale
    if (!isPidAlive(info.pid)) {
      fs.rmSync(lockFile, { force: true }); // clean up stale lock
      return false;
    }
    return true;
  } catch {
    fs.rmSync(lockFile, { force: true });
    return false;
  }
}

/** POST /api/tests/run?project=slug  — spawn test runner in background */
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const project = searchParams.get("project");

  if (!project || !/^[a-zA-Z0-9_-]+$/.test(project)) {
    return NextResponse.json({ error: "Invalid project name" }, { status: 400 });
  }

  const lockFile = runningFile(project);

  if (isActuallyRunning(lockFile)) {
    return NextResponse.json(
      { error: "Tests already running for this project" },
      { status: 409 }
    );
  }

  // Ensure results dir exists
  const projectResultsDir = path.join(RESULTS_DIR, project);
  fs.mkdirSync(projectResultsDir, { recursive: true });

  const runId = new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z");

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsed = (body ?? {}) as Record<string, unknown>;
  const workflowIds = parseSelection(parsed.workflow_ids);
  const caseIds = parseSelection(parsed.case_ids);

  const projectEnv = loadProjectEnv(project);
  const uvBin = findUv();
  const logFd = fs.openSync(path.join(projectResultsDir, "last_run.log"), "w");
  const args = ["run", "test_runner.py", project];
  if (workflowIds.length > 0) {
    args.push("--workflows", workflowIds.join(","));
  }
  if (caseIds.length > 0) {
    args.push("--cases", caseIds.join(","));
  }

  const proc = spawn(uvBin, args, {
    cwd: REGRESSION_DIR,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      ...projectEnv,
      PATH: `${process.env.PATH}:/usr/local/bin:/root/.local/bin:/root/.cargo/bin`,
    },
  });

  // Write lock file with PID so we can verify process is still alive later
  fs.writeFileSync(
    lockFile,
    JSON.stringify({
      run_id: runId,
      started_at: new Date().toISOString(),
      pid: proc.pid,
      workflow_ids: workflowIds,
      case_ids: caseIds,
    })
  );

  proc.on("exit", () => fs.rmSync(lockFile, { force: true }));
  proc.on("error", () => fs.rmSync(lockFile, { force: true }));
  proc.unref();

  return NextResponse.json({
    run_id: runId,
    status: "started",
    workflow_ids: workflowIds,
    case_ids: caseIds,
  });
}

/** GET /api/tests/run?project=slug  — check if tests are currently running */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const project = searchParams.get("project");

  if (!project || !/^[a-zA-Z0-9_-]+$/.test(project)) {
    return NextResponse.json({ error: "Invalid project name" }, { status: 400 });
  }

  const lockFile = runningFile(project);

  if (!isActuallyRunning(lockFile)) {
    return NextResponse.json({ running: false });
  }

  try {
    const info = JSON.parse(fs.readFileSync(lockFile, "utf-8"));
    return NextResponse.json({ running: true, ...info });
  } catch {
    return NextResponse.json({ running: true });
  }
}
