"use client";

import { useEffect, useState, useCallback } from "react";

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

interface Project {
  id: string;
  name: string;
  path: string;
}

export default function GitPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [logs, setLogs] = useState<CommitLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"status" | "branches" | "log">("status");
  const [commitMessage, setCommitMessage] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [showNewBranch, setShowNewBranch] = useState(false);

  // Load projects on mount
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

  useEffect(() => {
    if (selectedProjectId) {
      loadStatus();
      loadBranches();
      loadLogs();
    }
  }, [selectedProjectId, loadStatus, loadBranches, loadLogs]);

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
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const stagedFiles = status?.files.filter((f) => f.staged) || [];
  const unstagedFiles = status?.files.filter((f) => !f.staged) || [];

  const statusColors: Record<string, string> = {
    modified: "var(--yellow)",
    added: "var(--green)",
    deleted: "var(--red)",
    untracked: "var(--dim)",
    renamed: "var(--cyan)",
    copied: "var(--cyan)",
    unmerged: "var(--yellow)",
    unknown: "var(--dim)",
  };

  const showNoProjects = projects.length === 0 && selectedProjectId === "";

  // Active tab indicator style helper
  const tabActiveStyle = (isActive: boolean) =>
    isActive ? { background: "rgba(30,45,74,0.5)" } : {};

  return (
    <div className="h-screen flex flex-col" style={{ background: "var(--bg)", color: "var(--text)" }}>
      {showNoProjects ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1 }}>
          <p>No projects found. Add a project from the Dashboard.</p>
        </div>
      ) : (
        <>
          <div
            className="flex items-center gap-4 px-4 py-3"
            style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}
          >
            <h1 className="text-lg font-semibold" style={{ color: "var(--text)" }}>Git</h1>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="px-3 py-1.5 rounded text-sm"
              style={{ background: "rgba(30,45,74,0.5)", border: "1px solid var(--border)", color: "var(--text)" }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={loadStatus}
              className="px-3 py-1.5 rounded text-sm"
              style={{ background: "rgba(30,45,74,0.5)", border: "1px solid var(--border)", color: "var(--text)" }}
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={handlePull}
              disabled={loading}
              className="px-3 py-1.5 rounded text-sm"
              style={{ background: "rgba(0, 120, 255, 0.25)", border: "1px solid var(--border)", color: "var(--text)" }}
            >
              Pull
            </button>
            <button
              type="button"
              onClick={handlePush}
              disabled={loading}
              className="px-3 py-1.5 rounded text-sm"
              style={{ background: "rgba(0, 255, 136, 0.25)", border: "1px solid var(--border)", color: "var(--text)" }}
            >
              Push
            </button>
          </div>

          {error && (
            <div className="px-4 py-2" style={{ background: "rgba(255,0,0,0.25)", color: "var(--text)" }}>
              {error}
            </div>
          )}
          {success && (
            <div className="px-4 py-2" style={{ background: "rgba(0, 128, 0, 0.25)", color: "var(--text)" }}>
              {success}
              <button
                type="button"
                onClick={() => setSuccess(null)}
                className="ml-2 underline"
                style={{ textDecoration: "underline", color: "var(--text)" }}
              >
                Dismiss
              </button>
            </div>
          )}

          <div className="flex border-b" style={{ borderBottom: "1px solid var(--border)" }}>
            <button
              type="button"
              onClick={() => setActiveTab("status")}
              className="px-4 py-2"
              style={tabActiveStyle(activeTab === "status")}
            >
              Status
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("branches")}
              className="px-4 py-2"
              style={tabActiveStyle(activeTab === "branches")}
            >
              Branches
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("log")}
              className="px-4 py-2"
              style={tabActiveStyle(activeTab === "log")}
            >
              Log
            </button>
          </div>

          <div className="flex-1 overflow-auto p-4">
            {activeTab === "status" && status && (
              <div className="space-y-4" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div className="rounded p-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="flex items-center gap-4" style={{ display: "flex", alignItems: "center" }}>
                    <span style={{ color: "var(--dim)" }}>Branch:</span>
                    <span className="font-mono" style={{ color: "var(--text)" }}>{status.current}</span>
                    {status.tracking && (
                      <>
                        <span style={{ color: "var(--dim)" }}>→</span>
                        <span className="font-mono" style={{ color: "var(--cyan)" }}>{status.tracking}</span>
                      </>
                    )}
                    {status.ahead > 0 && <span style={{ color: "var(--yellow)" }}>↑{status.ahead}</span>}
                    {status.behind > 0 && <span style={{ color: "var(--dim)" }}>↓{status.behind}</span>}
                  </div>
                </div>

                {stagedFiles.length > 0 && (
                  <div className="rounded" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                    <div className="px-3 py-2 border-b" style={{ borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "var(--green)" }} className="text-sm font-medium">Staged Changes</span>
                      <button
                        type="button"
                        onClick={() => handleUnstage(stagedFiles.map((f) => f.path))}
                        className="text-xs"
                        style={{ color: "var(--text)" }}
                      >
                        Unstage All
                      </button>
                    </div>
                    <div className="p-2">
                    {stagedFiles.map((file) => (
                        <div key={file.path} className="flex items-center gap-2 py-1 text-sm" style={{ display: "flex", alignItems: "center" }}>
                          <span className="font-mono" style={{ color: statusColors[file.status] || "var(--dim)" }}>
                            {file.status.toUpperCase().padEnd(8)}
                          </span>
                          <span style={{ color: "var(--text)" }}>{file.path}</span>
                          <button
                            type="button"
                            onClick={() => handleUnstage([file.path])}
                            className="ml-auto text-xs"
                            style={{ marginLeft: "auto", color: "var(--dim)" }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {unstagedFiles.length > 0 && (
                  <div className="rounded" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                    <div className="px-3 py-2 border-b" style={{ borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "var(--yellow)" }} className="text-sm font-medium">Unstaged Changes</span>
                      <button
                        type="button"
                        onClick={() => handleStage(unstagedFiles.map((f) => f.path))}
                        className="text-xs"
                        style={{ color: "var(--text)" }}
                      >
                        Stage All
                      </button>
                    </div>
                    <div className="p-2">
                      {unstagedFiles.map((file) => (
                        <div key={file.path} className="flex items-center gap-2 py-1 text-sm" style={{ display: "flex", alignItems: "center" }}>
                          <span className="font-mono" style={{ color: statusColors[file.status] || "var(--dim)" }}>{file.status.toUpperCase().padEnd(8)}</span>
                          <span style={{ color: "var(--text)" }}>{file.path}</span>
                          <button
                            type="button"
                            onClick={() => handleStage([file.path])}
                            className="ml-auto text-xs"
                            style={{ color: "var(--dim)" }}
                          >
                            +
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded p-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <h3 className="text-sm font-medium mb-2" style={{ color: "var(--text)" }}>Commit</h3>
                  <textarea
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    placeholder="Commit message..."
                    className="w-full px-3 py-2 rounded text-sm mb-2 resize-none"
                    rows={3}
                    style={{
                      background: "rgba(30,45,74,0.5)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleCommit}
                    disabled={loading || !commitMessage.trim() || stagedFiles.length === 0}
                    className="px-4 py-2 rounded text-sm"
                    style={{ background: "rgba(0,255,136,0.5)", border: "1px solid var(--border)", color: "var(--text)" }}
                  >
                    Commit
                  </button>
                </div>
              </div>
            )}

            {activeTab === "branches" && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-medium" style={{ color: "var(--text)" }}>Local & Remote Branches</h3>
                  <button
                    type="button"
                    onClick={() => setShowNewBranch(!showNewBranch)}
                    className="px-3 py-1.5 rounded text-sm"
                    style={{ background: "rgba(0, 120, 255, 0.25)", border: "1px solid var(--border)", color: "var(--text)" }}
                  >
                    {showNewBranch ? "Cancel" : "New Branch"}
                  </button>
                </div>

                {showNewBranch && (
                  <div className="rounded p-3 flex gap-2" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                    <input
                      type="text"
                      value={newBranchName}
                      onChange={(e) => setNewBranchName(e.target.value)}
                      placeholder="branch-name"
                      className="flex-1 px-3 py-1.5 rounded text-sm"
                      style={{ background: "rgba(30,45,74,0.5)", border: "1px solid var(--border)", color: "var(--text)" }}
                    />
                    <button
                      type="button"
                      onClick={handleCreateBranch}
                      disabled={!newBranchName.trim()}
                      className="px-4 py-1.5 rounded text-sm"
                      style={{ background: "rgba(0,255,136,0.5)", border: "1px solid var(--border)", color: "var(--text)" }}
                    >
                      Create
                    </button>
                  </div>
                )}

                <div className="rounded" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  {branches.map((branch) => (
                    <div
                      key={branch.name}
                      className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0"
                      style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)", padding: "0.5rem 0.75rem" }}
                    >
                      {branch.current && (
                        <span style={{ color: "var(--green)" }}>●</span>
                      )}
                      <span className="font-mono text-sm" style={{ color: branch.current ? "var(--text)" : "var(--dim)" }}>
                        {branch.name}
                      </span>
                      {branch.remote && (
                        <span style={{ color: "var(--cyan)" }} className="text-xs">remote</span>
                      )}
                      {!branch.current && !branch.remote && (
                        <button
                          type="button"
                          onClick={() => handleDeleteBranch(branch.name)}
                          className="ml-auto text-xs"
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
              <div className="rounded" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                {logs.map((log) => (
                  <div
                    key={log.hash}
                    className="flex gap-4 px-3 py-3 border-b last:border-b-0"
                    style={{ display: "flex", gap: "1rem", padding: "0.75rem 0.75rem", borderBottom: "1px solid var(--border)" }}
                  >
                    <span style={{ color: "var(--yellow)" }} className="font-mono text-sm">{log.shortHash}</span>
                    <div className="flex-1" style={{ display: "flex", flexDirection: "column" }}>
                      <div style={{ color: "var(--text)", fontSize: "0.875rem" }}>{log.message}</div>
                      <div style={{ color: "var(--dim)", fontSize: "0.75rem", marginTop: "0.25rem" }}>
                        {log.author} · {new Date(log.date).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
