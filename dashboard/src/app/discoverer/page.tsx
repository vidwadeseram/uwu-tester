"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface ProjectInfo {
  name: string;
  path: string;
}

interface ProjectGroup {
  name: string;
  path: string;
  projects: ProjectInfo[];
}

interface ProjectsData {
  groups: ProjectGroup[];
}

interface WorkspaceOption {
  name: string;
  path: string;
  kind: "group" | "project";
}

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

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function toWorkspaceOptions(data: ProjectsData): WorkspaceOption[] {
  const options: WorkspaceOption[] = [];
  for (const group of data.groups ?? []) {
    if (group.path) {
      options.push({
        name: group.name || group.path,
        path: group.path,
        kind: "group",
      });
    }
    for (const project of group.projects ?? []) {
      if (!project.path) continue;
      options.push({
        name: group.name ? `${group.name}/${project.name || project.path}` : (project.name || project.path),
        path: project.path,
        kind: "project",
      });
    }
  }

  if (options.length === 0) {
    options.push({ name: "workspaces", path: "/opt/workspaces", kind: "group" });
  }

  const seen = new Set<string>();
  const unique = options.filter((opt) => {
    if (seen.has(opt.path)) return false;
    seen.add(opt.path);
    return true;
  });

  unique.sort((a, b) => a.name.localeCompare(b.name));
  return unique;
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

export default function DiscovererPage() {
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceOption[]>([]);
  const [workspacePath, setWorkspacePath] = useState("");
  const [project, setProject] = useState("");
  const [persistTests, setPersistTests] = useState(true);
  const [persistDocs, setPersistDocs] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DiscovererResponse | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState("");
  const [pickerSearch, setPickerSearch] = useState("");

  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");

  const [commitMessage, setCommitMessage] = useState("chore: update discoverer outputs");
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitError, setCommitError] = useState("");
  const [commitSuccess, setCommitSuccess] = useState("");

  const loadWorkspaceOptions = useCallback(async () => {
    setPickerLoading(true);
    setPickerError("");
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) {
        setPickerError("Failed to load folders");
        return;
      }
      const data = (await res.json()) as ProjectsData;
      const next = toWorkspaceOptions(data);
      setWorkspaceOptions(next);
      if (!workspacePath && next.length > 0) {
        setWorkspacePath(next[0].path);
        setProject((prev) => prev || toSlug(next[0].path.split("/").filter(Boolean).at(-1) ?? ""));
      }
    } catch {
      setPickerError("Failed to load folders");
    } finally {
      setPickerLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    void loadWorkspaceOptions();
  }, [loadWorkspaceOptions]);

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

  async function openPicker() {
    setPickerOpen(true);
    if (workspaceOptions.length === 0 && !pickerLoading) {
      await loadWorkspaceOptions();
    }
  }

  const runDiscoverer = useCallback(async () => {
    if (!canRun) return;
    setLoading(true);
    setError("");
    setResult(null);
    setReview(null);
    setReviewError("");
    setCommitError("");
    setCommitSuccess("");
    try {
      const res = await fetch("/api/discoverer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspacePath,
          project,
          persistTests,
          persistDocs,
        }),
      });
      const data = (await res.json()) as DiscovererResponse | { error?: string };
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "Discoverer failed");
        return;
      }
      setResult(data as DiscovererResponse);
      setCommitMessage(`chore: update discoverer outputs for ${project}`);
    } catch {
      setError("Network error while running Discoverer");
    } finally {
      setLoading(false);
    }
  }, [canRun, workspacePath, project, persistTests, persistDocs]);

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
            Analyze a workspace, generate test cases/docs, then review and commit generated artifacts.
          </p>
        </div>
      </div>

      <div className="card p-4 space-y-4" style={{ background: "rgba(30,45,74,0.35)", border: "1px solid #1e2d4a", borderRadius: 12 }}>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label htmlFor="discoverer-workspace-display" className="text-xs" style={{ color: "#94a3b8" }}>Workspace path</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={openPicker}
                className="px-3 py-2 rounded text-xs font-medium"
                style={{
                  background: "rgba(0,212,255,0.12)",
                  color: "#00d4ff",
                  border: "1px solid rgba(0,212,255,0.3)",
                  minWidth: "120px",
                }}
              >
                Select Folder
              </button>
              <div
                id="discoverer-workspace-display"
                className="w-full px-3 py-2 rounded text-sm font-mono"
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

        <div className="flex flex-wrap items-center gap-4">
          <label className="text-xs flex items-center gap-2" style={{ color: "#94a3b8" }}>
            <input type="checkbox" checked={persistTests} onChange={(e) => setPersistTests(e.target.checked)} />
            Save generated tests to regression_tests/test_cases
          </label>
          <label className="text-xs flex items-center gap-2" style={{ color: "#94a3b8" }}>
            <input type="checkbox" checked={persistDocs} onChange={(e) => setPersistDocs(e.target.checked)} />
            Save generated docs to openclaw/data/knowledge
          </label>
        </div>

        <button
          type="button"
          onClick={() => void runDiscoverer()}
          disabled={!canRun}
          className="px-4 py-2 rounded text-sm font-semibold"
          style={{
            background: canRun ? "linear-gradient(135deg,#00ff88,#00d4ff)" : "rgba(30,45,74,0.5)",
            color: canRun ? "#0a0e1a" : "#4a5568",
          }}
        >
          {loading ? "Discovering..." : "Run Discoverer"}
        </button>

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

      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPickerOpen(false);
          }}
        >
          <div
            className="w-full max-w-2xl max-h-[75vh] flex flex-col rounded-lg overflow-hidden"
            style={{ background: "#0f1629", border: "1px solid #1e2d4a" }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "#1e2d4a" }}>
              <div className="text-sm font-semibold" style={{ color: "#00d4ff" }}>Select Workspace Folder</div>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="text-xs px-2 py-1 rounded"
                style={{ background: "rgba(30,45,74,0.6)", color: "#94a3b8", border: "1px solid #1e2d4a" }}
              >
                ✕ Close
              </button>
            </div>

            <div className="px-4 py-3 border-b" style={{ borderColor: "#1e2d4a" }}>
              <input
                type="text"
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="Search folders..."
                className="w-full px-3 py-2 rounded text-sm"
                style={{ background: "#0f172a", color: "#e2e8f0", border: "1px solid #1e2d4a" }}
              />
            </div>

            <div className="p-3 overflow-y-auto space-y-2" style={{ maxHeight: "50vh" }}>
              {pickerLoading && (
                <div className="text-xs px-3 py-2 rounded" style={{ color: "#94a3b8", background: "rgba(30,45,74,0.3)" }}>
                  Loading folders...
                </div>
              )}
              {pickerError && (
                <div className="text-xs px-3 py-2 rounded" style={{ color: "#ff4444", background: "rgba(255,68,68,0.1)", border: "1px solid rgba(255,68,68,0.2)" }}>
                  {pickerError}
                </div>
              )}

              {!pickerLoading && workspaceOptions
                .filter((opt) => {
                  if (!pickerSearch.trim()) return true;
                  const q = pickerSearch.toLowerCase();
                  return opt.name.toLowerCase().includes(q) || opt.path.toLowerCase().includes(q);
                })
                .map((opt) => (
                  <button
                    key={opt.path}
                    type="button"
                    onClick={() => {
                      setWorkspacePath(opt.path);
                      setPickerOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded transition-opacity hover:opacity-85"
                    style={{
                      background: "rgba(30,45,74,0.35)",
                      border: workspacePath === opt.path ? "1px solid rgba(0,212,255,0.55)" : "1px solid rgba(30,45,74,0.7)",
                    }}
                  >
                    <div className="text-xs font-semibold" style={{ color: opt.kind === "project" ? "#00d4ff" : "#ffd700" }}>
                      {opt.name}
                    </div>
                    <div className="text-xs font-mono" style={{ color: "#94a3b8" }}>
                      {opt.path}
                    </div>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
