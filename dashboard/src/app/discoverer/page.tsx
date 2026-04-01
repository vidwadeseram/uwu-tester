"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FolderTreePicker from "../components/FolderTreePicker";

type DiscoverTarget = "api" | "claude" | "opencode";
type DiscoverRunStatus = "running" | "completed" | "failed";

interface DiscovererCase {
  id: string;
  label: string;
  task: string;
  enabled: boolean;
  depends_on?: string | null;
  skip_dependents_on_fail?: boolean;
}

interface DiscovererWorkflow {
  id: string;
  label: string;
  description?: string;
  enabled: boolean;
  case_ids: string[];
}

interface DiscovererResponse {
  project: string;
  workspacePath: string;
  testConfig: {
    project: string;
    description: string;
    test_cases: DiscovererCase[];
    workflows: DiscovererWorkflow[];
  };
  agentDocs: string;
  context: {
    workspaceName: string;
    fileCount: number;
    stackHints: string[];
    runScripts: string[];
    routeHints: string[];
  };
  persisted: {
    tests: boolean;
    docs: boolean;
    testCasesFile?: string;
    knowledgeFile?: string;
    testsMode?: "created" | "merged" | "unchanged" | "skipped";
    docsMode?: "created" | "appended" | "unchanged" | "skipped";
    testsMerge?: {
      mode: "merged" | "unchanged";
      addedCaseIds: string[];
      addedWorkflowIds: string[];
      reusedCaseIds: string[];
      reusedWorkflowIds: string[];
    };
    generationModel?: string;
  };
}

interface ReviewFile {
  path: string;
  status: string;
  diff: string;
}

interface ReviewResponse {
  repoRoot: string;
  hasChanges: boolean;
  files: ReviewFile[];
}

interface CommitResponse {
  ok: boolean;
  commit: string;
  summary: string;
  files: string[];
}

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
  response?: unknown;
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function statusColor(status: string): string {
  switch (status) {
    case "added":
      return "#22c55e";
    case "modified":
      return "#f59e0b";
    case "deleted":
      return "#ef4444";
    case "renamed":
      return "#38bdf8";
    case "untracked":
      return "#a78bfa";
    case "staged":
      return "#00d4ff";
    case "clean":
      return "#94a3b8";
    default:
      return "#94a3b8";
  }
}

function targetColor(target: DiscoverTarget): string {
  switch (target) {
    case "api":
      return "#00ff88";
    case "claude":
      return "#f97316";
    case "opencode":
      return "#a855f7";
    default:
      return "#94a3b8";
  }
}

function formatTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString();
}

function isDiscovererResponse(value: unknown): value is DiscovererResponse {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (typeof row.project !== "string") return false;
  if (typeof row.workspacePath !== "string") return false;
  if (!row.testConfig || typeof row.testConfig !== "object") return false;
  if (typeof row.agentDocs !== "string") return false;
  if (!row.context || typeof row.context !== "object") return false;
  if (!row.persisted || typeof row.persisted !== "object") return false;
  return true;
}

function docsPathFromRun(run: DiscoverRun): string {
  if (!run.response || !isDiscovererResponse(run.response)) return "";
  return run.response.persisted.knowledgeFile ?? "";
}

export default function DiscovererPage() {
  const [workspacePath, setWorkspacePath] = useState("");
  const [project, setProject] = useState("");
  const [persistTests, setPersistTests] = useState(true);
  const [persistDocs, setPersistDocs] = useState(true);
  const [testSavePath, setTestSavePath] = useState("");
  const [docsSavePath, setDocsSavePath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DiscovererResponse | null>(null);
  const [discoverRuns, setDiscoverRuns] = useState<DiscoverRun[]>([]);
  const [dismissedRunIds, setDismissedRunIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("dismissedDiscovererRunIds") ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const runStatusRef = useRef<Record<string, DiscoverRunStatus>>({});

  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");

  const [commitMessage, setCommitMessage] = useState("chore: update discoverer outputs");
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitError, setCommitError] = useState("");
  const [commitSuccess, setCommitSuccess] = useState("");

  useEffect(() => {
    if (!workspacePath) return;
    const inferred = toSlug(workspacePath.split("/").filter(Boolean).at(-1) ?? "");
    if (!inferred) return;
    setProject((prev) => prev || inferred);
  }, [workspacePath]);

  const reviewTargets = useMemo(
    () => [result?.persisted.testCasesFile, result?.persisted.knowledgeFile].filter(Boolean) as string[],
    [result]
  );

  const canRun = workspacePath.trim().length > 0 && project.trim().length > 0 && !loading;
  const testCaseCount = useMemo(() => result?.testConfig.test_cases.length ?? 0, [result]);
  const visibleRuns = useMemo(
    () => discoverRuns.filter((run) => !dismissedRunIds.includes(run.run_id)),
    [discoverRuns, dismissedRunIds]
  );
  const runningRuns = useMemo(
    () => visibleRuns.filter((run) => run.status === "running"),
    [visibleRuns]
  );
  const recentFinishedRuns = useMemo(
    () => visibleRuns.filter((run) => run.status !== "running").slice(0, 3),
    [visibleRuns]
  );

  const handleWorkspaceSelect = useCallback((path: string) => {
    setWorkspacePath(path);
    const inferred = toSlug(path.split("/").filter(Boolean).at(-1) ?? "");
    if (inferred) setProject((prev) => prev || inferred);
  }, []);

  const loadDiscoverRuns = useCallback(async (slug: string) => {
    const res = await fetch(`/api/discoverer/agent-run?project=${encodeURIComponent(slug)}`);
    if (!res.ok) return;
    const data = await res.json() as { runs?: DiscoverRun[] };
    const nextRuns = data.runs ?? [];

    const prevStatuses = runStatusRef.current;
    const nextStatuses: Record<string, DiscoverRunStatus> = {};
    let completedWithResponse: DiscoverRun | null = null;

    for (const run of nextRuns) {
      nextStatuses[run.run_id] = run.status;
      if (
        prevStatuses[run.run_id] === "running" &&
        run.status === "completed" &&
        run.response &&
        isDiscovererResponse(run.response)
      ) {
        completedWithResponse = run;
      }
    }

    runStatusRef.current = nextStatuses;
    setDiscoverRuns(nextRuns);

    if (completedWithResponse && isDiscovererResponse(completedWithResponse.response)) {
      setResult(completedWithResponse.response);
      setError("");
      setCommitMessage(`chore: update discoverer outputs for ${completedWithResponse.project}`);
    }
  }, []);

  const runDiscoverer = useCallback(async (target: DiscoverTarget) => {
    if (!canRun) return;
    setLoading(true);
    setError("");
    setReview(null);
    setReviewError("");
    setCommitError("");
    setCommitSuccess("");
    try {
      const res = await fetch("/api/discoverer/agent-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          workspacePath,
          project,
          persistTests,
          persistDocs,
          testSavePath: testSavePath || undefined,
          docsSavePath: docsSavePath || undefined,
        }),
      });
      const data = (await res.json()) as { error?: string; run_id?: string; target?: DiscoverTarget; project?: string };
      if (!res.ok) {
        setError(data.error ?? "Discoverer failed to start");
        return;
      }

      const runId = String(data.run_id ?? "");
      const now = new Date().toISOString();
      if (runId) {
        runStatusRef.current = { ...runStatusRef.current, [runId]: "running" };
        setDiscoverRuns((prev) => {
          if (prev.some((run) => run.run_id === runId)) return prev;
          return [
            {
              run_id: runId,
              target,
              project,
              workspacePath,
              persistTests,
              persistDocs,
              testSavePath: testSavePath || undefined,
              docsSavePath: docsSavePath || undefined,
              status: "running",
              started_at: now,
              pid: 0,
            },
            ...prev,
          ];
        });
      }
      void loadDiscoverRuns(project);
    } catch {
      setError("Network error while running Discoverer");
    } finally {
      setLoading(false);
    }
  }, [canRun, workspacePath, project, persistTests, persistDocs, testSavePath, docsSavePath, loadDiscoverRuns]);

  const loadReview = useCallback(async (files: string[]) => {
    if (files.length === 0) {
      setReview(null);
      return;
    }
    setReviewLoading(true);
    setReviewError("");
    try {
      const res = await fetch("/api/discoverer/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files }),
      });
      const data = (await res.json()) as ReviewResponse | { error?: string };
      if (!res.ok) {
        setReviewError((data as { error?: string }).error ?? "Failed to load review");
        setReview(null);
        return;
      }
      setReview(data as ReviewResponse);
    } catch {
      setReviewError("Failed to load review");
      setReview(null);
    } finally {
      setReviewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!result) return;
    if (reviewTargets.length === 0) {
      setReview(null);
      return;
    }
    void loadReview(reviewTargets);
  }, [result, reviewTargets, loadReview]);

  useEffect(() => {
    if (!project.trim()) {
      setDiscoverRuns([]);
      runStatusRef.current = {};
      return;
    }
    runStatusRef.current = {};
    void loadDiscoverRuns(project);
    const poll = setInterval(() => {
      void loadDiscoverRuns(project);
    }, 5000);

    return () => {
      clearInterval(poll);
    };
  }, [project, loadDiscoverRuns]);

  async function commitReviewedChanges() {
    if (!reviewTargets.length || commitLoading) return;
    setCommitLoading(true);
    setCommitError("");
    setCommitSuccess("");
    try {
      const res = await fetch("/api/discoverer/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: reviewTargets,
          message: commitMessage,
        }),
      });
      const data = (await res.json()) as CommitResponse | { error?: string };
      if (!res.ok) {
        setCommitError((data as { error?: string }).error ?? "Commit failed");
        return;
      }
      const commit = data as CommitResponse;
      setCommitSuccess(`Committed ${commit.commit}`);
      await loadReview(reviewTargets);
    } catch {
      setCommitError("Commit failed");
    } finally {
      setCommitLoading(false);
    }
  }

  return (
    <div className="max-w-screen-xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold" style={{ color: "#e2e8f0" }}>Discoverer</h1>
          <p className="text-xs" style={{ color: "#4a5568" }}>
            Analyze a workspace, generate test cases/docs in background, then review and commit generated artifacts.
          </p>
        </div>
      </div>

      {(runningRuns.length > 0 || recentFinishedRuns.length > 0) && (
        <div className="fixed top-[60px] right-4 z-50 w-full max-w-sm">
          <div
            className="rounded-lg p-3 space-y-2"
            style={{
              background: "rgba(10,14,26,0.95)",
              border: "1px solid rgba(0,212,255,0.25)",
              boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
            }}
          >
            <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#00d4ff" }}>
              Discoverer Runs
            </div>

            {runningRuns.map((run) => (
              <div key={run.run_id} className="rounded px-2 py-1.5" style={{ background: "rgba(30,45,74,0.45)", border: "1px solid rgba(30,45,74,0.7)" }}>
                <div className="flex items-center gap-2 text-xs" style={{ color: targetColor(run.target) }}>
                  <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <title>Running</title>
                    <path d="M21 12a9 9 0 1 1-9-9" />
                  </svg>
                  <span className="font-mono">{run.target} · {run.project}</span>
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: "#94a3b8" }}>
                  started {formatTime(run.started_at)}
                </div>
              </div>
            ))}

            {recentFinishedRuns.map((run) => (
              <div
                key={run.run_id}
                className="rounded px-2 py-1.5"
                style={{
                  background: run.status === "completed" ? "rgba(0,255,136,0.08)" : "rgba(255,68,68,0.08)",
                  border: `1px solid ${run.status === "completed" ? "rgba(0,255,136,0.3)" : "rgba(255,68,68,0.3)"}`,
                }}
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span style={{ color: run.status === "completed" ? "#00ff88" : "#ff4444" }} className="font-mono">
                    {run.target} · {run.project} · {run.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDismissedRunIds((prev) => {
                      const next = prev.includes(run.run_id) ? prev : [...prev, run.run_id];
                      localStorage.setItem("dismissedDiscovererRunIds", JSON.stringify(next));
                      return next;
                    })}
                    className="w-5 h-5 rounded text-[10px]"
                    style={{ background: "rgba(30,45,74,0.6)", color: "#94a3b8", border: "1px solid #1e2d4a" }}
                    title="Dismiss"
                  >
                    ✕
                  </button>
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: "#94a3b8" }}>
                  started {formatTime(run.started_at)}
                </div>
                {run.status === "completed" && docsPathFromRun(run) && (
                  <div className="text-[11px] mt-0.5 font-mono truncate" style={{ color: "#7dd3fc" }}>
                    docs: {docsPathFromRun(run)}
                  </div>
                )}
                {run.status === "failed" && run.summary && (
                  <pre className="text-[10px] mt-1 rounded p-1 overflow-x-auto whitespace-pre-wrap break-all" style={{ background: "rgba(0,0,0,0.3)", color: "#f87171", maxHeight: "8rem" }}>
                    {run.summary.slice(-800)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card p-4 space-y-4" style={{ background: "rgba(30,45,74,0.35)", border: "1px solid #1e2d4a", borderRadius: 12 }}>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <span className="text-xs" style={{ color: "#94a3b8" }}>Workspace path</span>
            <div className="flex gap-2 items-center">
              <FolderTreePicker
                value={workspacePath}
                onSelect={handleWorkspaceSelect}
                placeholder="Select workspace folder"
              />
              <div
                className="flex-1 px-3 py-2 rounded text-sm font-mono min-w-0"
                style={{ background: "#0f172a", color: "#e2e8f0", border: "1px solid #1e2d4a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={workspacePath || "No folder selected"}
              >
                {workspacePath || "No folder selected"}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="discoverer-project" className="text-xs" style={{ color: "#94a3b8" }}>Test project slug</label>
            <input
              id="discoverer-project"
              value={project}
              onChange={(e) => setProject(toSlug(e.target.value))}
              placeholder="my-project"
              className="w-full px-3 py-2 rounded text-sm"
              style={{ background: "#0f172a", color: "#e2e8f0", border: "1px solid #1e2d4a" }}
            />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs flex items-center gap-2" style={{ color: "#94a3b8" }}>
              <input type="checkbox" checked={persistTests} onChange={(e) => setPersistTests(e.target.checked)} />
              Save generated tests to:
            </label>
            {persistTests && (
              <div className="flex items-center gap-2">
                <FolderTreePicker
                  value={testSavePath}
                  onSelect={setTestSavePath}
                  compact
                  placeholder="Default (regression_tests/test_cases)"
                />
                {testSavePath && (
                  <button
                    type="button"
                    onClick={() => setTestSavePath("")}
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ color: "#94a3b8", background: "rgba(30,45,74,0.5)", border: "1px solid #1e2d4a" }}
                    title="Reset to default location"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
          </div>
          {persistTests && testSavePath && (
            <div className="text-[11px] font-mono ml-6 truncate" style={{ color: "#4a5568" }} title={testSavePath}>
              {testSavePath}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs flex items-center gap-2" style={{ color: "#94a3b8" }}>
              <input type="checkbox" checked={persistDocs} onChange={(e) => setPersistDocs(e.target.checked)} />
              Save generated docs to:
            </label>
            {persistDocs && (
              <div className="flex items-center gap-2">
                <FolderTreePicker
                  value={docsSavePath}
                  onSelect={setDocsSavePath}
                  compact
                  placeholder="Default (openclaw/data/knowledge)"
                />
                {docsSavePath && (
                  <button
                    type="button"
                    onClick={() => setDocsSavePath("")}
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ color: "#94a3b8", background: "rgba(30,45,74,0.5)", border: "1px solid #1e2d4a" }}
                    title="Reset to default location"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
          </div>
          {persistDocs && docsSavePath && (
            <div className="text-[11px] font-mono ml-6 truncate" style={{ color: "#4a5568" }} title={docsSavePath}>
              {docsSavePath}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runDiscoverer("api")}
            disabled={!canRun}
            className="px-3 py-2 rounded text-sm font-semibold"
            style={{
              background: canRun ? "linear-gradient(135deg,#00ff88,#00d4ff)" : "rgba(30,45,74,0.5)",
              color: canRun ? "#0a0e1a" : "#4a5568",
            }}
          >
            {loading ? "Starting..." : "Discover via API"}
          </button>
          <button
            type="button"
            onClick={() => void runDiscoverer("claude")}
            disabled={!canRun}
            className="px-3 py-2 rounded text-sm font-semibold"
            style={{
              background: canRun ? "rgba(249,115,22,0.16)" : "rgba(30,45,74,0.5)",
              color: canRun ? "#fdba74" : "#4a5568",
              border: "1px solid rgba(249,115,22,0.35)",
            }}
          >
            {loading ? "Starting..." : "Discover via Claude Code"}
          </button>
          <button
            type="button"
            onClick={() => void runDiscoverer("opencode")}
            disabled={!canRun}
            className="px-3 py-2 rounded text-sm font-semibold"
            style={{
              background: canRun ? "rgba(168,85,247,0.16)" : "rgba(30,45,74,0.5)",
              color: canRun ? "#d8b4fe" : "#4a5568",
              border: "1px solid rgba(168,85,247,0.35)",
            }}
          >
            {loading ? "Starting..." : "Discover via Opencode"}
          </button>
        </div>

        {error && (
          <div className="text-xs px-3 py-2 rounded" style={{ color: "#f87171", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)" }}>
            {error}
          </div>
        )}
      </div>

      {result && (
        <div className="space-y-4">
          <div className="grid md:grid-cols-3 gap-3">
            <div className="card p-3" style={{ background: "rgba(30,45,74,0.35)", border: "1px solid #1e2d4a", borderRadius: 10 }}>
              <div className="text-xs" style={{ color: "#4a5568" }}>Project</div>
              <div className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>{result.project}</div>
            </div>
            <div className="card p-3" style={{ background: "rgba(30,45,74,0.35)", border: "1px solid #1e2d4a", borderRadius: 10 }}>
              <div className="text-xs" style={{ color: "#4a5568" }}>Scanned files</div>
              <div className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>{result.context.fileCount}</div>
            </div>
            <div className="card p-3" style={{ background: "rgba(30,45,74,0.35)", border: "1px solid #1e2d4a", borderRadius: 10 }}>
              <div className="text-xs" style={{ color: "#4a5568" }}>Generated test cases</div>
              <div className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>{testCaseCount}</div>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="card p-3 space-y-2" style={{ background: "rgba(30,45,74,0.35)", border: "1px solid #1e2d4a", borderRadius: 10 }}>
              <div className="text-xs font-semibold" style={{ color: "#00d4ff" }}>Generated test config</div>
              <pre className="text-xs overflow-auto rounded p-3" style={{ background: "#0f172a", color: "#e2e8f0", maxHeight: 420 }}>
                {JSON.stringify(result.testConfig, null, 2)}
              </pre>
            </div>

            <div className="card p-3 space-y-2" style={{ background: "rgba(30,45,74,0.35)", border: "1px solid #1e2d4a", borderRadius: 10 }}>
              <div className="text-xs font-semibold" style={{ color: "#00ff88" }}>Generated agent docs</div>
              <pre className="text-xs overflow-auto rounded p-3 whitespace-pre-wrap" style={{ background: "#0f172a", color: "#e2e8f0", maxHeight: 420 }}>
                {result.agentDocs}
              </pre>
            </div>
          </div>

          <div className="text-xs" style={{ color: "#94a3b8" }}>
            {result.persisted.testCasesFile && (
              <div>
                Saved tests ({result.persisted.testsMode ?? "created"}): {result.persisted.testCasesFile}
              </div>
            )}
            {result.persisted.testsMerge && (
              <div>
                Tests merge: +{result.persisted.testsMerge.addedCaseIds.length} case(s), +{result.persisted.testsMerge.addedWorkflowIds.length} workflow(s), reused {result.persisted.testsMerge.reusedCaseIds.length} case(s) and {result.persisted.testsMerge.reusedWorkflowIds.length} workflow(s)
              </div>
            )}
            {result.persisted.knowledgeFile && (
              <div>
                Saved docs ({result.persisted.docsMode ?? "created"}): {result.persisted.knowledgeFile}
              </div>
            )}
            {result.persisted.generationModel && (
              <div>Generated with model: {result.persisted.generationModel}</div>
            )}
          </div>

          <div className="card p-4 space-y-3" style={{ background: "rgba(30,45,74,0.35)", border: "1px solid #1e2d4a", borderRadius: 12 }}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>Review & Commit</div>
                <div className="text-xs" style={{ color: "#94a3b8" }}>Review generated file diffs, then commit directly.</div>
              </div>
              <button
                type="button"
                onClick={() => void loadReview(reviewTargets)}
                disabled={reviewLoading || reviewTargets.length === 0}
                className="px-3 py-1.5 rounded text-xs"
                style={{
                  background: "rgba(30,45,74,0.6)",
                  color: reviewTargets.length === 0 ? "#4a5568" : "#00d4ff",
                  border: "1px solid #1e2d4a",
                }}
              >
                {reviewLoading ? "Refreshing..." : "Refresh Review"}
              </button>
            </div>

            {reviewTargets.length === 0 && (
              <div className="text-xs px-3 py-2 rounded" style={{ color: "#f59e0b", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)" }}>
                Enable at least one persist option to review and commit generated files.
              </div>
            )}

            {reviewError && (
              <div className="text-xs px-3 py-2 rounded" style={{ color: "#f87171", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)" }}>
                {reviewError}
              </div>
            )}

            {review && (
              <div className="space-y-2">
                <div className="text-xs" style={{ color: "#94a3b8" }}>
                  Repo: <span className="font-mono" style={{ color: "#e2e8f0" }}>{review.repoRoot}</span>
                </div>

                <div className="space-y-2 max-h-[320px] overflow-auto pr-1">
                  {review.files.map((file) => (
                    <details
                      key={file.path}
                      className="rounded"
                      style={{ background: "#0f172a", border: "1px solid #1e2d4a" }}
                    >
                      <summary className="px-3 py-2 cursor-pointer list-none flex items-center justify-between gap-2">
                        <span className="text-xs font-mono" style={{ color: "#e2e8f0" }}>{file.path}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded uppercase" style={{ color: statusColor(file.status), border: `1px solid ${statusColor(file.status)}55` }}>
                          {file.status}
                        </span>
                      </summary>
                      <pre className="text-[11px] overflow-auto px-3 pb-3 whitespace-pre-wrap" style={{ color: "#cbd5e1", borderTop: "1px solid #1e2d4a" }}>
                        {file.diff || "No diff available"}
                      </pre>
                    </details>
                  ))}
                </div>

                <div className="grid md:grid-cols-[1fr_auto] gap-2 items-center pt-1">
                  <input
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    placeholder="Commit message"
                    className="w-full px-3 py-2 rounded text-sm"
                    style={{ background: "#0f172a", color: "#e2e8f0", border: "1px solid #1e2d4a" }}
                  />
                  <button
                    type="button"
                    onClick={() => void commitReviewedChanges()}
                    disabled={commitLoading || !review.hasChanges}
                    className="px-4 py-2 rounded text-sm font-semibold"
                    style={{
                      background: review.hasChanges ? "linear-gradient(135deg,#00ff88,#00d4ff)" : "rgba(30,45,74,0.5)",
                      color: review.hasChanges ? "#0a0e1a" : "#4a5568",
                    }}
                  >
                    {commitLoading ? "Committing..." : "Commit Changes"}
                  </button>
                </div>

                {commitError && (
                  <div className="text-xs px-3 py-2 rounded" style={{ color: "#f87171", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)" }}>
                    {commitError}
                  </div>
                )}

                {commitSuccess && (
                  <div className="text-xs px-3 py-2 rounded" style={{ color: "#00ff88", background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.35)" }}>
                    {commitSuccess}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
