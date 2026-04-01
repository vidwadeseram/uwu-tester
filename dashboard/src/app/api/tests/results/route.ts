import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const REGRESSION_DIR = path.join(process.cwd(), "..", "regression_tests");
const RESULTS_DIR = path.join(REGRESSION_DIR, "results");

interface CaseResult {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
  duration_s: number;
  skipped: boolean;
  recording?: string | null;
}

interface RunResult {
  project: string;
  run_id: string;
  started_at: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  results: CaseResult[];
}

interface AgentRunMeta {
  run_id: string;
  project: string;
  target: "claude" | "opencode";
  status: "running" | "completed" | "failed";
  started_at: string;
  completed_at?: string;
  exit_code?: number;
  summary?: string;
}

function asRunResult(value: unknown, defaultProject: string): RunResult | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.run_id !== "string" || typeof row.started_at !== "string") return null;
  if (!Array.isArray(row.results)) return null;

  return {
    project: typeof row.project === "string" && row.project.length > 0 ? row.project : defaultProject,
    run_id: row.run_id,
    started_at: row.started_at,
    total: Number(row.total ?? 0),
    passed: Number(row.passed ?? 0),
    failed: Number(row.failed ?? 0),
    skipped: Number(row.skipped ?? 0),
    results: row.results as CaseResult[],
  };
}

function asAgentRunMeta(value: unknown): AgentRunMeta | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.run_id !== "string" ||
    typeof row.project !== "string" ||
    (row.target !== "claude" && row.target !== "opencode") ||
    (row.status !== "running" && row.status !== "completed" && row.status !== "failed") ||
    typeof row.started_at !== "string"
  ) {
    return null;
  }

  return {
    run_id: row.run_id,
    project: row.project,
    target: row.target,
    status: row.status,
    started_at: row.started_at,
    completed_at: typeof row.completed_at === "string" ? row.completed_at : undefined,
    exit_code: typeof row.exit_code === "number" ? row.exit_code : undefined,
    summary: typeof row.summary === "string" ? row.summary : undefined,
  };
}

function stripAnsi(input: string): string {
  return input.replace(new RegExp("\\u001B\\[[0-9;]*[A-Za-z]", "g"), "");
}

function summarizeFailure(rawSummary: string | undefined): string {
  if (!rawSummary) return "";

  const cleanedLines = stripAnsi(rawSummary)
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (cleanedLines.length === 0) return "";

  const interesting = cleanedLines.filter((line) => {
    const lowered = line.toLowerCase();
    return (
      lowered.includes("error") ||
      lowered.includes("failed") ||
      lowered.includes("exception") ||
      lowered.includes("traceback") ||
      lowered.includes("context window") ||
      lowered.includes("permission denied")
    );
  });

  const source = interesting.length > 0 ? interesting : cleanedLines;
  return source.slice(-3).join("\n").slice(0, 1000);
}

function toFallbackRun(meta: AgentRunMeta): RunResult {
  const failed = meta.status === "failed";
  const failureSummary = failed ? summarizeFailure(meta.summary) : "";
  const detail =
    failed && failureSummary.length > 0
      ? `Agent process failed before structured results were saved.\n${failureSummary}`
      : failed
      ? `Agent process failed${typeof meta.exit_code === "number" ? ` (exit ${meta.exit_code})` : ""}. Case-level test results were not persisted.`
      : `${meta.target} agent run completed, but case-level test results were not persisted via save_results.`;

  return {
    project: meta.project,
    run_id: meta.run_id,
    started_at: meta.started_at,
    total: 1,
    passed: 0,
    failed: failed ? 1 : 0,
    skipped: failed ? 0 : 1,
    results: [
      {
        id: `${meta.run_id}-agent-summary`,
        label: `${meta.target} agent run`,
        passed: false,
        detail,
        duration_s: 0,
        skipped: !failed,
      },
    ],
  };
}

function sortByStartedAtDesc(a: RunResult, b: RunResult): number {
  return new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
}

function pushRunIfNew(results: RunResult[], runIds: Set<string>, run: RunResult) {
  if (runIds.has(run.run_id)) return;
  results.push(run);
  runIds.add(run.run_id);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const project = searchParams.get("project");
  const limit = parseInt(searchParams.get("limit") ?? "10", 10);

  if (!project || !/^[a-zA-Z0-9_-]+$/.test(project)) {
    return NextResponse.json({ error: "Invalid project name" }, { status: 400 });
  }

  const projectResultsDir = path.join(RESULTS_DIR, project);

  if (!fs.existsSync(projectResultsDir)) {
    return NextResponse.json({ results: [] });
  }

  const files = fs
    .readdirSync(projectResultsDir)
    .filter((f) => f.endsWith(".json") && f !== "running.json")
    .sort()
    .reverse();

  const results: RunResult[] = [];
  const runIds = new Set<string>();
  for (const file of files) {
    try {
      const content = JSON.parse(fs.readFileSync(path.join(projectResultsDir, file), "utf-8"));
      const parsed = asRunResult(content, project);
      if (!parsed) continue;
      pushRunIfNew(results, runIds, parsed);
    } catch {
    }
  }

  const agentRunsDir = path.join(projectResultsDir, "agent_runs");
  if (fs.existsSync(agentRunsDir)) {
    const agentFiles = fs
      .readdirSync(agentRunsDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();

    for (const file of agentFiles) {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(agentRunsDir, file), "utf-8"));

        const parsedRun = asRunResult(content, project);
        if (parsedRun) {
          pushRunIfNew(results, runIds, parsedRun);
          continue;
        }

        const parsedMeta = asAgentRunMeta(content);
        if (!parsedMeta || parsedMeta.status === "running") continue;
        pushRunIfNew(results, runIds, toFallbackRun(parsedMeta));
      } catch {
      }
    }
  }

  results.sort(sortByStartedAtDesc);
  return NextResponse.json({ results: results.slice(0, limit) });
}
