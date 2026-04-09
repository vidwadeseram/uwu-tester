"use client";

import { useEffect, useState, useCallback } from "react";
import { GitDiffViewer } from "@/components/git/GitDiffViewer";

interface GitFile {
  path: string;
  status: string;
  staged: boolean;
}

interface GitStatus {
  current: string | null;
  tracking: string | null;
  ahead: number;
  behind: number;
  files: GitFile[];
}

interface Branch {
  name: string;
  current: boolean;
  remote: boolean;
  tracking: string | null;
}

interface CommitLog {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

interface Worktree {
  id: string;
  projectId: string;
  name: string;
  path: string;
  branch: string;
  isActive: boolean;
  isOnDisk: boolean;
  currentBranch: string;
  createdAt: string;
}

interface Project {
  id: string;
  name: string;
  path: string;
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  modified: { color: "var(--yellow)", bg: "rgba(255,215,0,0.1)", label: "M" },
  added: { color: "var(--green)", bg: "rgba(0,255,136,0.1)", label: "A" },
  deleted: { color: "var(--red)", bg: "rgba(255,68,68,0.1)", label: "D" },
  untracked: { color: "var(--dim)", bg: "rgba(148,163,184,0.1)", label: "?" },
  renamed: { color: "var(--cyan)", bg: "rgba(0,212,255,0.1)", label: "R" },
  copied: { color: "var(--cyan)", bg: "rgba(0,212,255,0.1)", label: "C" },
  unmerged: { color: "var(--yellow)", bg: "rgba(255,215,0,0.1)", label: "U" },
};

export default function GitPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [logs, setLogs] = useState<CommitLog[]>([]);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"status" | "branches" | "log" | "worktrees">("status");
  const [commitMessage, setCommitMessage] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [showNewWorktree, setShowNewWorktree] = useState(false);
  const [newWorktreeName, setNewWorktreeName] = useState("");
  const [newWorktreeBranch, setNewWorktreeBranch] = useState("");
  const [diffFilePath, setDiffFilePath] = useState<string | null>(null);
  const [diffStaged, setDiffStaged] = useState(false);
  const [diffContent, setDiffContent] = useState<string>("");
  const [diffLoading, setDiffLoading] = useState(false);
  const [commitDiffHash, setCommitDiffHash] = useState<string | null>(null);
  const [commitDiffContent, setCommitDiffContent] = useState<string>("");
  const [commitDiffLoading, setCommitDiffLoading] = useState(false);

  useEffect(() => {
    fetch("/api/projects")
      .then((res) => res.json())
      .then((data) => {
        const projs = data?.projects ?? data ?? [];
        if (Array.isArray(projs) && projs.length > 0) {
          setProjects(projs);
          setSelectedProjectId(projs[0].id);
        } else {
          setProjects([]);
          setSelectedProjectId("");
        }
      })
      .catch(console.error);
  }, []);

  const loadStatus = useCallback(async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/git/status?projectId=${selectedProjectId}`);
      const data = await res.json();
      setStatus(data.error ? null : data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  const loadBranches = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      const res = await fetch(`/api/git/branches?projectId=${selectedProjectId}`);
      const data = await res.json();
      setBranches(data.branches || []);
    } catch (err) {
      console.error(err);
    }
  }, [selectedProjectId]);

  const loadLogs = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      const res = await fetch(`/api/git/log?projectId=${selectedProjectId}&limit=30`);
      const data = await res.json();
      setLogs(data.logs || []);
    } catch (err) {
      console.error(err);
    }
  }, [selectedProjectId]);

  const loadWorktrees = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      const res = await fetch(`/api/worktrees?projectId=${selectedProjectId}`);
      const data = await res.json();
      setWorktrees(data.worktrees || []);
    } catch (err) {
      console.error(err);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (selectedProjectId) {
      loadStatus();
      loadBranches();
      loadLogs();
      loadWorktrees();
    }
  }, [selectedProjectId, loadStatus, loadBranches, loadLogs, loadWorktrees]);

  const handleStage = async (files: string[]) => {
    if (!selectedProjectId || files.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/git/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selectedProjectId, files }),
      });
      if (res.ok) {
        await loadStatus();
        setSuccess("Files staged");
        setTimeout(() => setSuccess(null), 2000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleUnstage = async (files: string[]) => {
    if (!selectedProjectId || files.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/git/unstage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selectedProjectId, files }),
      });
      if (res.ok) {
        await loadStatus();
        setSuccess("Files unstaged");
        setTimeout(() => setSuccess(null), 2000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!selectedProjectId || !commitMessage.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/git/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selectedProjectId, message: commitMessage }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess("Committed successfully");
        setCommitMessage("");
        await loadStatus();
        await loadLogs();
        setTimeout(() => setSuccess(null), 2000);
      } else {
        setError(data.error || "Failed to commit");
      }
    } catch (err) {
      setError("Failed to commit");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handlePush = async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/git/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selectedProjectId, setUpstream: true }),
      });
      if (res.ok) {
        setSuccess("Pushed successfully");
        await loadStatus();
        setTimeout(() => setSuccess(null), 2000);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to push");
      }
    } catch (err) {
      setError("Failed to push");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handlePull = async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/git/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selectedProjectId, rebase: false }),
      });
      if (res.ok) {
        setSuccess("Pulled successfully");
        await loadStatus();
        await loadLogs();
        setTimeout(() => setSuccess(null), 2000);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to pull");
      }
    } catch (err) {
      setError("Failed to pull");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBranch = async () => {
    if (!selectedProjectId || !newBranchName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/git/branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selectedProjectId, name: newBranchName }),
      });
      if (res.ok) {
        setSuccess(`Branch ${newBranchName} created`);
        setNewBranchName("");
        setShowNewBranch(false);
        await loadBranches();
        setTimeout(() => setSuccess(null), 2000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteBranch = async (name: string) => {
    if (!selectedProjectId || !name) return;
    setLoading(true);
    try {
      await fetch(`/api/git/branches?name=${encodeURIComponent(name)}&projectId=${selectedProjectId}`, {
        method: "DELETE",
      });
      await loadBranches();
      setSuccess(`Branch ${name} deleted`);
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckout = async (name: string) => {
    if (!selectedProjectId || !name) return;
    setLoading(true);
    try {
      const res = await fetch("/api/git/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selectedProjectId, branch: name }),
      });
      if (res.ok) {
        setSuccess(`Switched to ${name}`);
        await loadStatus();
        await loadBranches();
        setTimeout(() => setSuccess(null), 2000);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to checkout");
      }
    } catch (err) {
      setError("Failed to checkout");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateWorktree = async () => {
    if (!selectedProjectId || !newWorktreeName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: selectedProjectId,
          name: newWorktreeName,
          branch: newWorktreeBranch || newWorktreeName,
          isNewBranch: true,
        }),
      });
      if (res.ok) {
        setSuccess(`Worktree ${newWorktreeName} created`);
        setNewWorktreeName("");
        setNewWorktreeBranch("");
        setShowNewWorktree(false);
        await loadWorktrees();
        setTimeout(() => setSuccess(null), 2000);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to create worktree");
      }
    } catch (err) {
      console.error(err);
      setError("Failed to create worktree");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteWorktree = async (id: string) => {
    setLoading(true);
    try {
      await fetch(`/api/worktrees/${id}`, { method: "DELETE" });
      await loadWorktrees();
      setSuccess("Worktree removed");
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadFileDiff = useCallback(async (filePath: string, staged: boolean) => {
    if (!selectedProjectId) return;
    if (diffFilePath === filePath && diffStaged === staged) {
      setDiffFilePath(null);
      setDiffContent("");
      return;
    }
    setDiffFilePath(filePath);
    setDiffStaged(staged);
    setDiffLoading(true);
    try {
      const res = await fetch(`/api/git/diff?projectId=${selectedProjectId}&path=${encodeURIComponent(filePath)}&staged=${staged}`);
      const data = await res.json();
      setDiffContent(data.diff || "");
    } catch (err) {
      console.error(err);
      setDiffContent("");
    } finally {
      setDiffLoading(false);
    }
  }, [selectedProjectId, diffFilePath, diffStaged]);

  const loadCommitDiff = useCallback(async (hash: string) => {
    if (!selectedProjectId) return;
    if (commitDiffHash === hash) {
      setCommitDiffHash(null);
      setCommitDiffContent("");
      return;
    }
    setCommitDiffHash(hash);
    setCommitDiffLoading(true);
    try {
      const res = await fetch(`/api/git/diff?projectId=${selectedProjectId}&commit=${hash}`);
      const data = await res.json();
      setCommitDiffContent(data.diff || "");
    } catch (err) {
      console.error(err);
      setCommitDiffContent("");
    } finally {
      setCommitDiffLoading(false);
    }
  }, [selectedProjectId, commitDiffHash]);

  const stagedFiles = status?.files.filter((f) => f.staged) || [];
  const unstagedFiles = status?.files.filter((f) => !f.staged) || [];

  const showNoProjects = projects.length === 0 && selectedProjectId === "";

  return (
    <div className="h-screen flex flex-col fade-in" style={{ background: "var(--bg)", color: "var(--text)" }}>
      {showNoProjects ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center p-8">
            <div className="mb-4" style={{ fontSize: "3rem", filter: "grayscale(0.5)" }}>📂</div>
            <h2 className="text-lg font-medium mb-2" style={{ color: "var(--text)" }}>No Projects</h2>
            <p style={{ color: "var(--dim)" }}>Clone or add a project from the Dashboard to get started.</p>
          </div>
        </div>
      ) : (
        <>
          {/* Header */}
          <div
            className="flex items-center justify-between px-5 py-3"
            style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-4">
              <h1 className="text-base font-semibold" style={{ color: "var(--text)" }}>Git</h1>
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="px-3 py-1.5 rounded text-sm font-mono"
                style={{
                  background: "var(--btn-bg)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  minWidth: "140px",
                }}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              {loading && (
                <span
                  className="spinner w-4 h-4"
                  style={{ border: "2px solid rgba(0,212,255,0.2)", borderTopColor: "var(--cyan)" }}
                />
              )}
              <button
                type="button"
                onClick={loadStatus}
                disabled={loading}
                className="px-3 py-1.5 rounded text-xs font-medium transition-opacity disabled:opacity-50"
                style={{ background: "var(--btn-bg)", border: "1px solid var(--border)", color: "var(--dim)" }}
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={handlePull}
                disabled={loading}
                className="px-4 py-1.5 rounded text-xs font-medium"
                style={{ background: "rgba(0,180,255,0.15)", border: "1px solid rgba(0,180,255,0.3)", color: "#00b4ff" }}
              >
                ↓ Pull
              </button>
              <button
                type="button"
                onClick={handlePush}
                disabled={loading}
                className="px-4 py-1.5 rounded text-xs font-medium"
                style={{ background: "rgba(0,255,136,0.15)", border: "1px solid rgba(0,255,136,0.3)", color: "var(--green)" }}
              >
                ↑ Push
              </button>
            </div>
          </div>

          {/* Status bar */}
          {error && (
            <div
              className="px-4 py-2 text-sm flex items-center justify-between"
              style={{ background: "rgba(255,68,68,0.15)", borderBottom: "1px solid rgba(255,68,68,0.3)" }}
            >
              <span style={{ color: "var(--red)" }}>{error}</span>
              <button type="button" onClick={() => setError(null)} className="text-xs opacity-60 hover:opacity-100" style={{ color: "var(--red)" }}>
                Dismiss
              </button>
            </div>
          )}
          {success && (
            <div
              className="px-4 py-2 text-sm flex items-center justify-between"
              style={{ background: "rgba(0,255,136,0.15)", borderBottom: "1px solid rgba(0,255,136,0.3)" }}
            >
              <span style={{ color: "var(--green)" }}>{success}</span>
            </div>
          )}

          {/* Branch info */}
          {status && (
            <div
              className="flex items-center gap-6 px-5 py-2.5 text-sm"
              style={{ background: "var(--hover-bg)", borderBottom: "1px solid var(--border)" }}
            >
              <div className="flex items-center gap-2">
                <span style={{ color: "var(--dim)" }}>Branch</span>
                <span className="font-mono px-2 py-0.5 rounded" style={{ background: "rgba(0,212,255,0.1)", color: "var(--cyan)" }}>
                  {status.current || "detached"}
                </span>
              </div>
              {status.tracking && (
                <div className="flex items-center gap-2">
                  <span style={{ color: "var(--dim)" }}>→</span>
                  <span className="font-mono text-xs" style={{ color: "var(--dim)" }}>{status.tracking}</span>
                </div>
              )}
              {status.ahead > 0 && (
                <span className="px-2 py-0.5 rounded text-xs font-mono" style={{ background: "rgba(255,215,0,0.1)", color: "var(--yellow)" }}>
                  ↑{status.ahead}
                </span>
              )}
              {status.behind > 0 && (
                <span className="px-2 py-0.5 rounded text-xs font-mono" style={{ background: "rgba(148,163,184,0.1)", color: "var(--dim)" }}>
                  ↓{status.behind}
                </span>
              )}
            </div>
          )}

          {/* Tabs */}
          <div
            className="flex border-b"
            style={{ borderBottom: "1px solid var(--border)", background: "var(--card)" }}
          >
            <button
              type="button"
              onClick={() => setActiveTab("status")}
              className="px-5 py-2.5 text-sm font-medium transition-colors"
              style={{
                color: activeTab === "status" ? "var(--cyan)" : "var(--dim)",
                borderBottom: activeTab === "status" ? "2px solid var(--cyan)" : "2px solid transparent",
                marginBottom: "-1px",
              }}
            >
              Status
              {status && status.files.length > 0 && (
                <span
                  className="ml-2 px-1.5 py-0.5 rounded text-xs"
                  style={{ background: "rgba(255,215,0,0.2)", color: "var(--yellow)" }}
                >
                  {status.files.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("branches")}
              className="px-5 py-2.5 text-sm font-medium transition-colors"
              style={{
                color: activeTab === "branches" ? "var(--cyan)" : "var(--dim)",
                borderBottom: activeTab === "branches" ? "2px solid var(--cyan)" : "2px solid transparent",
                marginBottom: "-1px",
              }}
            >
              Branches
              <span
                className="ml-2 px-1.5 py-0.5 rounded text-xs"
                style={{ background: "var(--btn-bg)", color: "var(--dim)" }}
              >
                {branches.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("log")}
              className="px-5 py-2.5 text-sm font-medium transition-colors"
              style={{
                color: activeTab === "log" ? "var(--cyan)" : "var(--dim)",
                borderBottom: activeTab === "log" ? "2px solid var(--cyan)" : "2px solid transparent",
                marginBottom: "-1px",
              }}
            >
              Log
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab("worktrees"); loadWorktrees(); }}
              className="px-5 py-2.5 text-sm font-medium transition-colors"
              style={{
                color: activeTab === "worktrees" ? "var(--cyan)" : "var(--dim)",
                borderBottom: activeTab === "worktrees" ? "2px solid var(--cyan)" : "2px solid transparent",
                marginBottom: "-1px",
              }}
            >
              Worktrees
              {worktrees.length > 0 && (
                <span
                  className="ml-2 px-1.5 py-0.5 rounded text-xs"
                  style={{ background: "var(--btn-bg)", color: "var(--dim)" }}
                >
                  {worktrees.length}
                </span>
              )}
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto">
            {activeTab === "status" && !status && loading && (
              <div className="p-4 space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="skeleton rounded-lg" style={{ height: 60, animationDelay: `${(i - 1) * 0.08}s` }} />
                ))}
              </div>
            )}
            {activeTab === "status" && status && (
              <div className="p-4 space-y-4 fade-in">
                {/* Staged */}
                {stagedFiles.length > 0 && (
                  <div className="rounded-lg overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                    <div
                      className="flex items-center justify-between px-4 py-2.5"
                      style={{ background: "rgba(0,255,136,0.05)", borderBottom: "1px solid var(--border)" }}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ background: "var(--green)" }}
                        />
                        <span className="text-sm font-medium" style={{ color: "var(--green)" }}>
                          Staged
                        </span>
                        <span className="text-xs font-mono px-1.5 rounded" style={{ background: "rgba(0,255,136,0.1)", color: "var(--green)" }}>
                          {stagedFiles.length}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleUnstage(stagedFiles.map((f) => f.path))}
                        className="text-xs px-2 py-1 rounded transition-colors"
                        style={{ color: "var(--dim)" }}
                      >
                        Unstage All
                      </button>
                    </div>
                    <div style={{ borderColor: "var(--border)" }}>
                      {stagedFiles.map((file) => {
                        const cfg = STATUS_CONFIG[file.status] || STATUS_CONFIG.unknown;
                        const isViewingDiff = diffFilePath === file.path && diffStaged === true;
                        return (
                          <div key={file.path}>
                            <button
                              type="button"
                              className="flex items-center gap-3 px-4 py-2 group cursor-pointer w-full text-left"
                              style={{ borderBottom: "1px solid var(--border)", background: isViewingDiff ? "var(--selected-bg)" : "transparent" }}
                              onClick={() => loadFileDiff(file.path, true)}
                            >
                              <span
                                className="badge text-xs font-mono"
                                style={{ background: cfg.bg, color: cfg.color }}
                              >
                                {cfg.label}
                              </span>
                              <span className="flex-1 text-sm font-mono truncate" style={{ color: "var(--text)" }}>
                                {file.path}
                              </span>
                              <span className="text-xs opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "var(--cyan)" }}>
                                {isViewingDiff ? "✕" : "Diff"}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleUnstage([file.path]); }}
                                className="opacity-0 group-hover:opacity-100 text-xs px-2 py-1 rounded transition-opacity"
                                style={{ color: "var(--dim)" }}
                              >
                                Unstage
                              </button>
                            </button>
                            {isViewingDiff && (
                              <div style={{ borderBottom: "1px solid var(--border)" }} className="px-2 py-2">
                                {diffLoading ? (
                                  <div className="flex items-center justify-center py-4">
                                    <span className="spinner w-4 h-4" style={{ border: "2px solid rgba(0,212,255,0.2)", borderTopColor: "var(--cyan)" }} />
                                  </div>
                                ) : (
                                  <GitDiffViewer diff={diffContent} emptyMessage="No staged changes for this file" />
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Unstaged */}
                {unstagedFiles.length > 0 && (
                  <div className="rounded-lg overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                    <div
                      className="flex items-center justify-between px-4 py-2.5"
                      style={{ background: "rgba(255,215,0,0.05)", borderBottom: "1px solid var(--border)" }}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ background: "var(--yellow)" }}
                        />
                        <span className="text-sm font-medium" style={{ color: "var(--yellow)" }}>
                          Unstaged
                        </span>
                        <span className="text-xs font-mono px-1.5 rounded" style={{ background: "rgba(255,215,0,0.1)", color: "var(--yellow)" }}>
                          {unstagedFiles.length}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleStage(unstagedFiles.map((f) => f.path))}
                        className="text-xs px-2 py-1 rounded transition-colors"
                        style={{ color: "var(--dim)" }}
                      >
                        Stage All
                      </button>
                    </div>
                    <div style={{ borderColor: "var(--border)" }}>
                      {unstagedFiles.map((file) => {
                        const cfg = STATUS_CONFIG[file.status] || STATUS_CONFIG.unknown;
                        const isViewingDiff = diffFilePath === file.path && diffStaged === false;
                        return (
                          <div key={file.path}>
                            <button
                              type="button"
                              className="flex items-center gap-3 px-4 py-2 group cursor-pointer w-full text-left"
                              style={{ borderBottom: "1px solid var(--border)", background: isViewingDiff ? "var(--selected-bg)" : "transparent" }}
                              onClick={() => loadFileDiff(file.path, false)}
                            >
                              <span
                                className="badge text-xs font-mono"
                                style={{ background: cfg.bg, color: cfg.color }}
                              >
                                {cfg.label}
                              </span>
                              <span className="flex-1 text-sm font-mono truncate" style={{ color: "var(--text)" }}>
                                {file.path}
                              </span>
                              <span className="text-xs opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "var(--cyan)" }}>
                                {isViewingDiff ? "✕" : "Diff"}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleStage([file.path]); }}
                                className="opacity-0 group-hover:opacity-100 text-xs px-2 py-1 rounded transition-opacity"
                                style={{ color: "var(--dim)" }}
                              >
                                Stage
                              </button>
                            </button>
                            {isViewingDiff && (
                              <div style={{ borderBottom: "1px solid var(--border)" }} className="px-2 py-2">
                                {diffLoading ? (
                                  <div className="flex items-center justify-center py-4">
                                    <span className="spinner w-4 h-4" style={{ border: "2px solid rgba(0,212,255,0.2)", borderTopColor: "var(--cyan)" }} />
                                  </div>
                                ) : (
                                  <GitDiffViewer diff={diffContent} emptyMessage="No unstaged changes for this file" />
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Commit */}
                <div
                  className="rounded-lg overflow-hidden"
                  style={{ background: "var(--card)", border: "1px solid var(--border)" }}
                >
                  <div className="p-4">
                    <textarea
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      placeholder="Commit message..."
                      className="w-full px-3 py-2 rounded text-sm resize-none font-mono"
                      rows={3}
                      style={{
                        background: "var(--btn-bg)",
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                      }}
                    />
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-xs" style={{ color: "var(--dim)" }}>
                        {stagedFiles.length} file{stagedFiles.length !== 1 ? "s" : ""} staged
                      </span>
                      <button
                        type="button"
                        onClick={handleCommit}
                        disabled={loading || !commitMessage.trim() || stagedFiles.length === 0}
                        className="px-5 py-2 rounded text-sm font-medium transition-opacity flex items-center justify-center"
                        style={{
                          background: stagedFiles.length > 0 && commitMessage.trim()
                            ? "rgba(0,255,136,0.2)"
                            : "var(--btn-bg)",
                          border: "1px solid var(--border)",
                          color: stagedFiles.length > 0 && commitMessage.trim() ? "var(--green)" : "var(--dim)",
                          minWidth: "80px",
                        }}
                      >
                        {loading ? (
                          <span className="spinner w-4 h-4 inline-block" style={{ border: "2px solid rgba(0,255,136,0.2)", borderTopColor: "#00ff88" }} />
                        ) : "Commit"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Empty state */}
                {status.files.length === 0 && (
                  <div className="text-center py-12">
                    <div className="mb-3" style={{ fontSize: "2.5rem", opacity: 0.5 }}>✓</div>
                    <p className="text-sm" style={{ color: "var(--dim)" }}>Working tree clean</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === "branches" && (
              <div className="p-4 space-y-4 fade-in">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium" style={{ color: "var(--text)" }}>Branches</h3>
                  <button
                    type="button"
                    onClick={() => setShowNewBranch(!showNewBranch)}
                    className="px-3 py-1.5 rounded text-xs font-medium"
                    style={{ background: "rgba(0,180,255,0.15)", border: "1px solid rgba(0,180,255,0.3)", color: "#00b4ff" }}
                  >
                    {showNewBranch ? "Cancel" : "New Branch"}
                  </button>
                </div>

                {showNewBranch && (
                  <div
                    className="flex items-center gap-3 p-4 rounded-lg"
                    style={{ background: "var(--card)", border: "1px solid var(--border)" }}
                  >
                    <input
                      type="text"
                      value={newBranchName}
                      onChange={(e) => setNewBranchName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleCreateBranch()}
                      placeholder="feature/branch-name"
                      className="flex-1 px-3 py-2 rounded text-sm font-mono"
                      style={{ background: "var(--btn-bg)", border: "1px solid var(--border)", color: "var(--text)" }}
                    />
                    <button
                      type="button"
                      onClick={handleCreateBranch}
                      disabled={!newBranchName.trim() || loading}
                      className="px-4 py-2 rounded text-sm font-medium flex items-center justify-center"
                      style={{
                        background: newBranchName.trim() ? "rgba(0,255,136,0.2)" : "var(--btn-bg)",
                        border: "1px solid var(--border)",
                        color: newBranchName.trim() ? "var(--green)" : "var(--dim)",
                        minWidth: "70px",
                      }}
                    >
                      {loading ? (
                        <span className="spinner w-3.5 h-3.5 inline-block" style={{ border: "2px solid rgba(0,255,136,0.2)", borderTopColor: "#00ff88" }} />
                      ) : "Create"}
                    </button>
                  </div>
                )}

                <div className="rounded-lg overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  {branches.map((branch) => (
                    <div
                      key={branch.name}
                      className="flex items-center gap-3 px-4 py-3 group"
                      style={{ borderBottom: "1px solid var(--border)" }}
                    >
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ background: branch.current ? "var(--green)" : "transparent", border: branch.current ? "none" : "1px solid var(--dim)" }}
                      />
                      <span className="font-mono text-sm flex-1" style={{ color: branch.current ? "var(--text)" : "var(--dim)" }}>
                        {branch.name}
                      </span>
                      {branch.remote && (
                        <span className="text-xs px-2 py-0.5 rounded" style={{ background: "rgba(0,212,255,0.1)", color: "var(--cyan)" }}>
                          remote
                        </span>
                      )}
                      {!branch.current && !branch.remote && (
                        <button
                          type="button"
                          onClick={() => handleCheckout(branch.name)}
                          className="opacity-0 group-hover:opacity-100 text-xs px-2 py-1 rounded transition-opacity"
                          style={{ color: "var(--cyan)" }}
                        >
                          Checkout
                        </button>
                      )}
                      {!branch.current && !branch.remote && (
                        <button
                          type="button"
                          onClick={() => handleDeleteBranch(branch.name)}
                          className="opacity-0 group-hover:opacity-100 text-xs px-2 py-1 rounded transition-opacity"
                          style={{ color: "var(--red)" }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "log" && (
              <div className="p-4 fade-in">
                <div className="rounded-lg overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  {logs.map((log, i) => {
                    const isViewingCommitDiff = commitDiffHash === log.hash;
                    return (
                      <div key={log.hash}>
                        <button
                          type="button"
                          className="flex items-start gap-4 px-4 py-3 group slide-up w-full text-left cursor-pointer"
                          style={{ borderBottom: isViewingCommitDiff ? "none" : (i < logs.length - 1 ? "1px solid var(--border)" : "none"), "--i": Math.min(i, 10), background: isViewingCommitDiff ? "var(--selected-bg)" : "transparent" } as React.CSSProperties}
                          onClick={() => loadCommitDiff(log.hash)}
                        >
                          <span
                            className="font-mono text-xs px-2 py-1 rounded shrink-0"
                            style={{ background: "rgba(255,215,0,0.1)", color: "var(--yellow)" }}
                          >
                            {log.shortHash}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm leading-snug" style={{ color: "var(--text)" }}>
                              {log.message}
                            </div>
                            <div className="text-xs mt-1" style={{ color: "var(--dim)" }}>
                              {log.author} · {new Date(log.date).toLocaleString()}
                            </div>
                          </div>
                          <span className="text-xs opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1" style={{ color: "var(--cyan)" }}>
                            {isViewingCommitDiff ? "✕" : "Diff"}
                          </span>
                        </button>
                        {isViewingCommitDiff && (
                          <div style={{ borderBottom: "1px solid var(--border)" }} className="px-2 py-3">
                            {commitDiffLoading ? (
                              <div className="flex items-center justify-center py-4">
                                <span className="spinner w-4 h-4" style={{ border: "2px solid rgba(0,212,255,0.2)", borderTopColor: "var(--cyan)" }} />
                              </div>
                            ) : (
                              <GitDiffViewer diff={commitDiffContent} emptyMessage="No changes in this commit" defaultExpanded={false} />
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeTab === "worktrees" && (
              <div className="p-4 space-y-4 fade-in">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium" style={{ color: "var(--text)" }}>Worktrees</h3>
                  <button
                    type="button"
                    onClick={() => setShowNewWorktree(!showNewWorktree)}
                    className="px-3 py-1.5 rounded text-xs font-medium"
                    style={{ background: "rgba(0,180,255,0.15)", border: "1px solid rgba(0,180,255,0.3)", color: "#00b4ff" }}
                  >
                    {showNewWorktree ? "Cancel" : "New Worktree"}
                  </button>
                </div>

                {showNewWorktree && (
                  <div
                    className="flex flex-col gap-3 p-4 rounded-lg"
                    style={{ background: "var(--card)", border: "1px solid var(--border)" }}
                  >
                    <input
                      type="text"
                      value={newWorktreeName}
                      onChange={(e) => setNewWorktreeName(e.target.value)}
                      placeholder="worktree-name"
                      className="px-3 py-2 rounded text-sm font-mono"
                      style={{ background: "var(--btn-bg)", border: "1px solid var(--border)", color: "var(--text)" }}
                    />
                    <input
                      type="text"
                      value={newWorktreeBranch}
                      onChange={(e) => setNewWorktreeBranch(e.target.value)}
                      placeholder="Branch name (defaults to worktree name)"
                      className="px-3 py-2 rounded text-sm font-mono"
                      style={{ background: "var(--btn-bg)", border: "1px solid var(--border)", color: "var(--text)" }}
                    />
                    <button
                      type="button"
                      onClick={handleCreateWorktree}
                      disabled={!newWorktreeName.trim() || loading}
                      className="px-4 py-2 rounded text-sm font-medium flex items-center justify-center"
                      style={{
                        background: newWorktreeName.trim() ? "rgba(0,255,136,0.2)" : "var(--btn-bg)",
                        border: "1px solid var(--border)",
                        color: newWorktreeName.trim() ? "var(--green)" : "var(--dim)",
                        minWidth: "70px",
                      }}
                    >
                      {loading ? (
                        <span className="spinner w-3.5 h-3.5 inline-block" style={{ border: "2px solid rgba(0,255,136,0.2)", borderTopColor: "#00ff88" }} />
                      ) : "Create"}
                    </button>
                  </div>
                )}

                {worktrees.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-sm" style={{ color: "var(--dim)" }}>No worktrees yet</p>
                  </div>
                ) : (
                  <div className="rounded-lg overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                    {worktrees.map((wt) => (
                      <div
                        key={wt.id}
                        className="flex items-center gap-3 px-4 py-3 group"
                        style={{ borderBottom: "1px solid var(--border)" }}
                      >
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: wt.isOnDisk ? "var(--green)" : "var(--red)" }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-sm" style={{ color: "var(--text)" }}>{wt.name}</div>
                          <div className="text-xs font-mono truncate" style={{ color: "var(--dim)" }}>{wt.path}</div>
                          {wt.currentBranch && (
                            <div className="text-xs mt-0.5">
                              <span className="px-1.5 py-0.5 rounded" style={{ background: "rgba(0,212,255,0.1)", color: "var(--cyan)" }}>
                                {wt.currentBranch}
                              </span>
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteWorktree(wt.id)}
                          className="opacity-0 group-hover:opacity-100 text-xs px-2 py-1 rounded transition-opacity"
                          style={{ color: "var(--red)" }}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}