import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { getReadableProjectPaths } from "@/app/lib/tests-paths";

function findUv(): string {
  const candidates = [
    "/usr/local/bin/uv",
    "/root/.local/bin/uv",
    "/root/.cargo/bin/uv",
    "/home/ubuntu/.local/bin/uv",
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "uv";
}

function toIsoToken(value = new Date()): string {
  return value.toISOString().replace(/[:.]/g, "").replace("Z", "Z");
}

function listRecordings(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return [];
  const files: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === ".webm" || ext === ".mp4") files.push(abs);
    }
  }
  return files;
}

function extractStructuredSummary(raw: string): { passed?: boolean; summary?: string } | null {
  const markerMatches = Array.from(raw.matchAll(/UWU_SPEC_RESULT\s*=\s*(\{[\s\S]*?\})/g));
  if (markerMatches.length === 0) return null;
  const last = markerMatches[markerMatches.length - 1]?.[1] ?? "";
  if (!last) return null;
  try {
    const parsed = JSON.parse(last) as { passed?: unknown; summary?: unknown };
    return {
      passed: typeof parsed.passed === "boolean" ? parsed.passed : undefined,
      summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
    };
  } catch {
    return null;
  }
}

function isInside(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const project = (searchParams.get("project") ?? "").trim();
  if (!project || !/^[a-zA-Z0-9_-]+$/.test(project)) {
    return NextResponse.json({ error: "Invalid project name" }, { status: 400 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsed = (body ?? {}) as Record<string, unknown>;
  const requestedSpecPath = typeof parsed.specPath === "string" ? parsed.specPath.trim() : "";
  const requestedUrl = typeof parsed.targetUrl === "string" ? parsed.targetUrl.trim() : "";

  const projectPaths = getReadableProjectPaths(project);
  const defaultSpecPath = path.join(projectPaths.regressionDir, "specs", `${project}.spec.py`);
  const specPath = requestedSpecPath || defaultSpecPath;
  const resolvedSpecPath = path.resolve(specPath);

  const allowedRoots = [projectPaths.regressionDir, projectPaths.workspacePath].filter((v): v is string => !!v);
  if (!allowedRoots.some((root) => isInside(root, resolvedSpecPath))) {
    return NextResponse.json({ error: "specPath must be within regression/workspace paths for this project" }, { status: 400 });
  }
  if (!fs.existsSync(resolvedSpecPath)) {
    return NextResponse.json({ error: `Spec file not found: ${resolvedSpecPath}` }, { status: 404 });
  }

  const runId = `spec_${toIsoToken()}_${Math.random().toString(36).slice(2, 7)}`;
  const startedAtIso = new Date().toISOString();

  const recordingsDir = path.join(projectPaths.resultsDir, project, "recordings", "spec_runs", runId);
  const specRunDir = path.join(projectPaths.projectResultsDir, "spec_runs", runId);
  fs.mkdirSync(recordingsDir, { recursive: true });
  fs.mkdirSync(specRunDir, { recursive: true });

  const uvBin = findUv();
  const cwd = projectPaths.workspacePath || projectPaths.regressionDir;

  const runResult = await new Promise<{
    code: number;
    stdout: string;
    stderr: string;
    errorMessage?: string;
    durationS: number;
  }>((resolve) => {
    const started = Date.now();
    execFile(
      uvBin,
      ["run", "python", resolvedSpecPath],
      {
        cwd,
        timeout: 15 * 60_000,
        maxBuffer: 30 * 1024 * 1024,
        env: {
          ...process.env,
          PATH: `${process.env.PATH ?? ""}:/usr/local/bin:/root/.local/bin:/root/.cargo/bin`,
          UWU_SPEC_RECORDING_DIR: recordingsDir,
          UWU_SPEC_TARGET_URL: requestedUrl,
          UWU_SPEC_RUN_ID: runId,
        },
      },
      (error, stdout, stderr) => {
        const durationS = Math.max(0, (Date.now() - started) / 1000);
        let code = 0;
        if (error) {
          const errCode = (error as NodeJS.ErrnoException).code;
          code = typeof errCode === "number" ? errCode : 1;
        }
        resolve({
          code,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          errorMessage: error ? String((error as Error).message ?? "") : undefined,
          durationS,
        });
      }
    );
  });

  const completedAtIso = new Date().toISOString();
  const combinedOutput = `${runResult.stdout}\n${runResult.stderr}`;
  const structured = extractStructuredSummary(combinedOutput);
  const passed = typeof structured?.passed === "boolean" ? structured.passed : runResult.code === 0;
  const summary = structured?.summary
    ?? (passed
      ? "Spec execution completed successfully"
      : (runResult.stderr.trim() || runResult.errorMessage || "Spec execution failed"));

  const recordings = listRecordings(recordingsDir).map((abs) => {
    const rel = path.relative(projectPaths.resultsDir, abs).replaceAll("\\", "/");
    return rel.startsWith("/") ? rel.slice(1) : rel;
  });

  const caseResult = {
    id: `${runId}_playwright_spec`,
    label: path.basename(resolvedSpecPath),
    passed,
    skipped: false,
    detail: summary,
    duration_s: runResult.durationS,
    recording: recordings[0] ?? null,
  };

  const report = {
    project,
    run_id: runId,
    started_at: startedAtIso,
    completed_at: completedAtIso,
    total: 1,
    passed: passed ? 1 : 0,
    failed: passed ? 0 : 1,
    skipped: 0,
    results: [caseResult],
  };

  fs.mkdirSync(projectPaths.projectResultsDir, { recursive: true });
  fs.writeFileSync(path.join(projectPaths.projectResultsDir, `${runId}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(
    path.join(specRunDir, "execution.json"),
    JSON.stringify(
      {
        project,
        run_id: runId,
        spec_path: resolvedSpecPath,
        cwd,
        passed,
        summary,
        exit_code: runResult.code,
        recordings,
        started_at: startedAtIso,
        completed_at: completedAtIso,
        stdout_tail: runResult.stdout.slice(-16_000),
        stderr_tail: runResult.stderr.slice(-16_000),
      },
      null,
      2
    )
  );

  return NextResponse.json({
    success: true,
    run_id: runId,
    passed,
    summary,
    recordings,
    report,
  });
}
