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
  sourceUrl: string;
  testConfig: {
    project: string;
    description: string;
    test_cases: DiscovererCase[];
    workflows: DiscovererWorkflow[];
  };
  spec: string;
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
    specFile?: string;
    specMode?: "created" | "updated" | "unchanged";
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
    specModel?: string;
    generationWarning?: string;
    historyId?: string;
  };
}

interface ReviewFile {
  path: string;
  relPath?: string;
  repoRoot?: string;
  status: string;
  diff: string;
}

interface ReviewResponse {
  repoRoot: string;
  repoRoots?: string[];
  hasChanges: boolean;
  files: ReviewFile[];
}

interface CommitResponse {
  ok: boolean;
  commit: string;
  summary: string;
  files: string[];
}

interface DiscovererHistoryChange {
  kind: "tests" | "docs" | "spec";
  path: string;
  existedBefore: boolean;
  existsAfter: boolean;
  changed: boolean;
  beforeBytes: number;
  afterBytes: number;
  beforeHash?: string;
  afterHash?: string;
}

interface DiscovererHistoryEntry {
  id: string;
  project: string;
  workspacePath: string;
  generationTarget: DiscoverTarget;
  generationModel?: string;
  generationWarning?: string;
  createdAt: string;
  changes: DiscovererHistoryChange[];
}

interface HistoryListResponse {
  entries: DiscovererHistoryEntry[];
  total: number;
}

interface HistoryRevertResponse {
  ok: boolean;
  id: string;
  restored: string[];
  missingSnapshots: string[];
  reviewTargets: string[];
  entry: DiscovererHistoryEntry;
}

interface DiscoverRun {
  run_id: string;
  target: DiscoverTarget;
  project: string;
  workspacePath: string;
  sourceUrl?: string;
  persistTests: boolean;
  persistDocs: boolean;
  specSavePath?: string;
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

function specPathFromRun(run: DiscoverRun): string {
  if (run.response && isDiscovererResponse(run.response)) {
    const specFile = run.response.persisted.specFile;
    if (typeof specFile === "string" && specFile.trim()) {
      return specFile;
    }
  }
  return run.specSavePath ?? "";
}

export default function DiscovererPage() {
  const [workspacePath, setWorkspacePath] = useState("");
  const [project, setProject] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [specSavePath, setSpecSavePath] = useState("");
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

  const [historyEntries, setHistoryEntries] = useState<DiscovererHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyActionMessage, setHistoryActionMessage] = useState("");
  const [revertingHistoryId, setRevertingHistoryId] = useState("");

  useEffect(() => {
    if (!workspacePath) return;
    const inferred = toSlug(workspacePath.split("/").filter(Boolean).at(-1) ?? "");
    if (!inferred) return;
    setProject((prev) => prev || inferred);
  }, [workspacePath]);

  const reviewTargets = useMemo(() => [result?.persisted.specFile].filter(Boolean) as string[], [result]);

  const canRun = workspacePath.trim().length > 0 && project.trim().length > 0 && sourceUrl.trim().length > 0 && !loading;
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
          sourceUrl,
          persistTests: false,
          persistDocs: false,
          specSavePath: specSavePath || undefined,
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
              sourceUrl,
              persistTests: false,
              persistDocs: false,
              specSavePath: specSavePath || undefined,
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
  }, [canRun, workspacePath, project, sourceUrl, specSavePath, loadDiscoverRuns]);

  const loadHistory = useCallback(async (slug: string) => {
    if (!slug.trim()) {
      setHistoryEntries([]);
      return;
    }
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const res = await fetch(`/api/discoverer/history?project=${encodeURIComponent(slug)}&limit=30`);
      const data = (await res.json()) as HistoryListResponse | { error?: string };
      if (!res.ok) {
        setHistoryError((data as { error?: string }).error ?? "Failed to load history");
        setHistoryEntries([]);
        return;
      }
      setHistoryEntries((data as HistoryListResponse).entries ?? []);
    } catch {
      setHistoryError("Failed to load history");
      setHistoryEntries([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

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

  const revertHistory = useCallback(async (entry: DiscovererHistoryEntry) => {
    if (!entry?.id || revertingHistoryId) return;
    const confirmed = confirm(`Revert Discoverer outputs to history entry ${entry.id}?`);
    if (!confirmed) return;

    setRevertingHistoryId(entry.id);
    setHistoryActionMessage("");
    setHistoryError("");
    try {
      const res = await fetch("/api/discoverer/history/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id }),
      });
      const data = (await res.json()) as HistoryRevertResponse | { error?: string };
      if (!res.ok) {
        setHistoryError((data as { error?: string }).error ?? "Failed to revert history entry");
        return;
      }

      const reverted = data as HistoryRevertResponse;
      setHistoryActionMessage(`Reverted ${reverted.restored.length} file(s) from ${entry.id}`);
      await loadHistory(project);
      if (Array.isArray(reverted.reviewTargets) && reverted.reviewTargets.length > 0) {
        await loadReview(reverted.reviewTargets);
      }
    } catch {
      setHistoryError("Failed to revert history entry");
    } finally {
      setRevertingHistoryId("");
    }
  }, [loadHistory, loadReview, project, revertingHistoryId]);

  useEffect(() => {
    if (!result) return;
    if (reviewTargets.length === 0) {
      setReview(null);
      return;
    }
    void loadReview(reviewTargets);
  }, [result, reviewTargets, loadReview]);

  useEffect(() => {
    if (!project.trim()) return;
    if (!result?.persisted.historyId) return;
    void loadHistory(project);
  }, [result?.persisted.historyId, project, loadHistory]);

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

  useEffect(() => {
    if (!project.trim()) {
      setHistoryEntries([]);
      setHistoryError("");
      return;
    }
    void loadHistory(project);
    const poll = setInterval(() => {
      void loadHistory(project);
    }, 10000);

    return () => {
      clearInterval(poll);
    };
  }, [project, loadHistory]);

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
            Analyze a workspace, generate Playwright spec in background, then review and commit generated artifacts.
          </p>
        </div>
      </div>

      {(runningRuns.length > 0 || recentFinishedRuns.length > 0) && (
        <div className="fixed top-[60px] inset-x-3 sm:inset-x-auto sm:right-4 z-50 sm:w-full max-w-sm">
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
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          <div className="space-y-1">
            <span className="text-xs" style={{ color: "#94a3b8" }}>Workspace path</span>
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
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

          <div className="space-y-1">
            <label htmlFor="discoverer-source-url" className="text-xs" style={{ color: "#94a3b8" }}>Web URL</label>
            <input
              id="discoverer-source-url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://example.com"
              className="w-full px-3 py-2 rounded text-sm"
              style={{ background: "#0f172a", color: "#e2e8f0", border: "1px solid #1e2d4a" }}
            />
          </div>
        </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs flex items-center gap-2" style={{ color: "#94a3b8" }}>
                Save generated Playwright spec to:
            </span>
            <div className="flex items-center gap-2">
              <FolderTreePicker
                value={specSavePath}
                onSelect={setSpecSavePath}
                compact
                placeholder="Default (regression_tests/specs)"
              />
              {specSavePath && (
                <button
                  type="button"
                  onClick={() => setSpecSavePath("")}
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ color: "#94a3b8", background: "rgba(30,45,74,0.5)", border: "1px solid #1e2d4a" }}
                  title="Reset to default location"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
          {specSavePath && (
            <div className="text-[11px] font-mono ml-6 truncate" style={{ color: "#4a5568" }} title={specSavePath}>
              {specSavePath}
            </div>
          )}

            <div className="text-[11px] ml-0" style={{ color: "#64748b" }}>
              Discoverer currently saves only Playwright specs from this page.
            </div>
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

      <div className="card p-4 space-y-3" style={{ background: "rgba(30,45,74,0.35)", border: "1px solid #1e2d4a", borderRadius: 12 }}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <div className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>Run History</div>
            <div className="text-xs" style={{ color: "#94a3b8" }}>Browse older Discoverer runs for this project.</div>
          </div>
          <button
            type="button"
            onClick={() => void loadDiscoverRuns(project)}
            disabled={!project.trim()}
            className="px-3 py-1.5 rounded text-xs"
            style={{
              background: "rgba(30,45,74,0.6)",
              color: project.trim() ? "#00d4ff" : "#4a5568",
              border: "1px solid #1e2d4a",
            }}
          >
            Refresh Runs
          </button>
        </div>

        {!project.trim() ? (
          <div className="text-xs px-3 py-2 rounded" style={{ color: "#94a3b8", background: "rgba(15,23,42,0.7)", border: "1px solid #1e2d4a" }}>
            Enter a project slug to load run history.
          </div>
        ) : discoverRuns.length === 0 ? (
          <div className="text-xs px-3 py-2 rounded" style={{ color: "#94a3b8", background: "rgba(15,23,42,0.7)", border: "1px solid #1e2d4a" }}>
            No Discoverer runs yet for this project.
          </div>
        ) : (
          <div className="space-y-2 max-h-[320px] overflow-auto pr-1">
            {discoverRuns.map((run) => (
              <details
                key={run.run_id}
                className="rounded"
                style={{ background: "#0f172a", border: "1px solid #1e2d4a" }}
              >
                <summary className="px-3 py-2 cursor-pointer list-none flex items-center justify-between gap-2">
                  <span className="text-xs font-mono" style={{ color: "#e2e8f0" }}>
                    {run.run_id}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded uppercase" style={{ color: run.status === "completed" ? "#22c55e" : run.status === "failed" ? "#ef4444" : "#00d4ff", border: `1px solid ${run.status === "completed" ? "#22c55e55" : run.status === "failed" ? "#ef444455" : "#00d4ff55"}` }}>
                    {run.status}
                  </span>
                </summary>
                <div className="px-3 pb-3 space-y-1 text-xs" style={{ color: "#94a3b8", borderTop: "1px solid #1e2d4a" }}>
                  <div>target: <span className="font-mono" style={{ color: targetColor(run.target) }}>{run.target}</span></div>
                  <div>started: <span className="font-mono" style={{ color: "#e2e8f0" }}>{formatTime(run.started_at)}</span></div>
                  {run.completed_at && <div>completed: <span className="font-mono" style={{ color: "#e2e8f0" }}>{formatTime(run.completed_at)}</span></div>}
                  <div>workspace: <span className="font-mono break-all" style={{ color: "#e2e8f0" }}>{run.workspacePath}</span></div>
                  {run.sourceUrl && <div>url: <span className="font-mono break-all" style={{ color: "#e2e8f0" }}>{run.sourceUrl}</span></div>}
                  {specPathFromRun(run) && (
                    <div>
                      spec: <span className="font-mono break-all" style={{ color: "#7dd3fc" }}>{specPathFromRun(run)}</span>
                    </div>
                  )}
                  {run.summary && (
                    <pre className="text-[10px] mt-1 rounded p-1 overflow-x-auto whitespace-pre-wrap break-all" style={{ background: "rgba(0,0,0,0.3)", color: run.status === "failed" ? "#f87171" : "#94a3b8", maxHeight: "8rem" }}>
                      {run.summary}
                    </pre>
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="card p-3" style={{ background: "rgba(30,45,74,0.35)", border: "1px solid #1e2d4a", borderRadius: 10 }}>
              <div className="text-xs" style={{ color: "#4a5568" }}>Project</div>
              <div className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>{result.project}</div>
            </div>
            <div className="card p-3" style={{ background: "rgba(30,45,74,0.35)", border: "1px solid #1e2d4a", borderRadius: 10 }}>
              <div className="text-xs" style={{ color: "#4a5568" }}>Scanned files</div>
              <div className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>{result.context.fileCount}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-1 gap-4">
            <div className="card p-3 space-y-2" style={{ background: "rgba(30,45,74,0.35)", border: "1px solid #1e2d4a", borderRadius: 10 }}>
              <div className="text-xs font-semibold" style={{ color: "#7dd3fc" }}>Generated Playwright spec</div>
              <pre className="text-xs overflow-auto rounded p-3 whitespace-pre-wrap" style={{ background: "#0f172a", color: "#e2e8f0", maxHeight: 420 }}>
                {result.spec}
              </pre>
            </div>
          </div>

          <div className="text-xs" style={{ color: "#94a3b8" }}>
            <div>
              Source URL: <span className="font-mono" style={{ color: "#e2e8f0" }}>{result.sourceUrl}</span>
            </div>
            {result.persisted.specFile && (
              <div>
                Saved spec ({result.persisted.specMode ?? "created"}): {result.persisted.specFile}
              </div>
            )}
            {result.persisted.generationModel && (
              <div>Generated with model: {result.persisted.generationModel}</div>
            )}
            {result.persisted.specModel && (
              <div>Spec generated with: {result.persisted.specModel}</div>
            )}
            {result.persisted.generationWarning && (
              <div style={{ color: "#fbbf24" }}>Generation fallback: {result.persisted.generationWarning}</div>
            )}
            {result.persisted.historyId && (
              <div>History snapshot: {result.persisted.historyId}</div>
            )}
          </div>

          <div className="card p-4 space-y-3" style={{ background: "rgba(30,45,74,0.35)", border: "1px solid #1e2d4a", borderRadius: 12 }}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
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
                No spec output file available yet for review.
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
                  {Array.isArray(review.repoRoots) && review.repoRoots.length > 1 ? (
                    <>
                      Repos: <span className="font-mono" style={{ color: "#e2e8f0" }}>{review.repoRoots.join(" · ")}</span>
                    </>
                  ) : (
                    <>
                      Repo: <span className="font-mono" style={{ color: "#e2e8f0" }}>{review.repoRoot}</span>
                    </>
                  )}
                </div>

                <div className="space-y-2 max-h-[320px] overflow-auto pr-1">
                  {review.files.map((file) => (
                    <details
                      key={file.path}
                      className="rounded"
                      style={{ background: "#0f172a", border: "1px solid #1e2d4a" }}
                    >
                      <summary className="px-3 py-2 cursor-pointer list-none flex items-center justify-between gap-2">
                        <span className="text-xs font-mono" style={{ color: "#e2e8f0" }}>
                          {file.relPath ?? file.path}
                          {file.repoRoot && (
                            <span style={{ color: "#64748b" }}> ({file.repoRoot})</span>
                          )}
                        </span>
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

                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-center pt-1">
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

      <div className="card p-4 space-y-3" style={{ background: "rgba(30,45,74,0.35)", border: "1px solid #1e2d4a", borderRadius: 12 }}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <div className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>History</div>
                <div className="text-xs" style={{ color: "#94a3b8" }}>See what changed in generated files and revert to a previous snapshot.</div>
              </div>
              <button
                type="button"
                onClick={() => void loadHistory(project)}
                disabled={historyLoading || !project.trim()}
                className="px-3 py-1.5 rounded text-xs"
                style={{
                  background: "rgba(30,45,74,0.6)",
                  color: project.trim() ? "#00d4ff" : "#4a5568",
                  border: "1px solid #1e2d4a",
                }}
              >
                {historyLoading ? "Refreshing..." : "Refresh History"}
              </button>
            </div>

            {historyError && (
              <div className="text-xs px-3 py-2 rounded" style={{ color: "#f87171", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)" }}>
                {historyError}
              </div>
            )}

            {historyActionMessage && (
              <div className="text-xs px-3 py-2 rounded" style={{ color: "#00ff88", background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.35)" }}>
                {historyActionMessage}
              </div>
            )}

            {historyEntries.length === 0 ? (
              <div className="text-xs px-3 py-2 rounded" style={{ color: "#94a3b8", background: "rgba(15,23,42,0.7)", border: "1px solid #1e2d4a" }}>
                {historyLoading ? "Loading history..." : "No history yet for this project."}
              </div>
            ) : (
              <div className="space-y-2 max-h-[320px] overflow-auto pr-1">
                {historyEntries.map((entry) => (
                  <details
                    key={entry.id}
                    className="rounded"
                    style={{ background: "#0f172a", border: "1px solid #1e2d4a" }}
                  >
                    <summary className="px-3 py-2 cursor-pointer list-none flex items-center justify-between gap-2">
                      <span className="text-xs font-mono" style={{ color: "#e2e8f0" }}>
                        {entry.id}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded uppercase" style={{ color: targetColor(entry.generationTarget), border: `1px solid ${targetColor(entry.generationTarget)}55` }}>
                        {entry.generationTarget}
                      </span>
                    </summary>

                    <div className="px-3 pb-3 space-y-2 text-xs" style={{ color: "#94a3b8", borderTop: "1px solid #1e2d4a" }}>
                      <div>
                        {formatTime(entry.createdAt)} · {entry.workspacePath}
                      </div>
                      {entry.generationModel && (
                        <div>model: <span className="font-mono" style={{ color: "#e2e8f0" }}>{entry.generationModel}</span></div>
                      )}
                      {entry.generationWarning && (
                        <div style={{ color: "#fbbf24" }}>{entry.generationWarning}</div>
                      )}

                      <div className="space-y-1">
                        {entry.changes.map((change) => (
                          <div
                            key={`${entry.id}-${change.kind}-${change.path}`}
                            className="rounded px-2 py-1"
                            style={{ background: "rgba(30,45,74,0.4)", border: "1px solid #1e2d4a" }}
                          >
                            <div className="font-mono truncate" style={{ color: "#cbd5e1" }}>{change.path}</div>
                            <div>
                              {change.kind} · {change.beforeBytes}B → {change.afterBytes}B · {change.changed ? "changed" : "unchanged"}
                            </div>
                            <div className="font-mono" style={{ color: "#64748b" }}>
                              {change.beforeHash?.slice(0, 8) ?? "none"} → {change.afterHash?.slice(0, 8) ?? "none"}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => void revertHistory(entry)}
                          disabled={Boolean(revertingHistoryId) && revertingHistoryId !== entry.id}
                          className="px-3 py-1.5 rounded text-xs font-semibold"
                          style={{
                            background: "rgba(168,85,247,0.15)",
                            color: "#d8b4fe",
                            border: "1px solid rgba(168,85,247,0.35)",
                          }}
                        >
                          {revertingHistoryId === entry.id ? "Reverting..." : "Revert to this snapshot"}
                        </button>
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>
    </div>
  );
}
