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

  useEffect(() => {
    fetch("/api/projects")
      .then((res) => res.json())
      .then((data) => {
        if (data.projects && data.projects.length > 0) {
          setProjects(data.projects);
          setSelectedProjectId(data.projects[0].id);
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
    modified: "text-yellow-400",
    added: "text-green-400",
    deleted: "text-red-400",
    untracked: "text-gray-400",
    renamed: "text-blue-400",
    copied: "text-purple-400",
    unmerged: "text-orange-400",
    unknown: "text-gray-400",
  };

  return (
    <div className="h-screen flex flex-col bg-slate-900 text-slate-100">
      <div className="flex items-center gap-4 px-4 py-3 bg-slate-800 border-b border-slate-700">
        <h1 className="text-lg font-semibold">Git</h1>
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          className="px-3 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm"
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
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={handlePull}
          disabled={loading}
          className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 rounded text-sm disabled:opacity-50"
        >
          Pull
        </button>
        <button
          type="button"
          onClick={handlePush}
          disabled={loading}
          className="px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded text-sm disabled:opacity-50"
        >
          Push
        </button>
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-900/50 text-red-300 text-sm">{error}</div>
      )}
      {success && (
        <div className="px-4 py-2 bg-green-900/50 text-green-300 text-sm">
          {success}
          <button
            type="button"
            onClick={() => setSuccess(null)}
            className="ml-2 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex border-b border-slate-700">
        <button
          type="button"
          onClick={() => setActiveTab("status")}
          className={`px-4 py-2 ${activeTab === "status" ? "bg-slate-700" : ""}`}
        >
          Status
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("branches")}
          className={`px-4 py-2 ${activeTab === "branches" ? "bg-slate-700" : ""}`}
        >
          Branches
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("log")}
          className={`px-4 py-2 ${activeTab === "log" ? "bg-slate-700" : ""}`}
        >
          Log
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {activeTab === "status" && status && (
          <div className="space-y-4">
            <div className="bg-slate-800 rounded p-3">
              <div className="flex items-center gap-4 text-sm">
                <span className="text-slate-400">Branch:</span>
                <span className="text-green-400 font-mono">{status.current}</span>
                {status.tracking && (
                  <>
                    <span className="text-slate-400">→</span>
                    <span className="text-blue-400 font-mono">{status.tracking}</span>
                  </>
                )}
                {status.ahead > 0 && (
                  <span className="text-yellow-400">↑{status.ahead}</span>
                )}
                {status.behind > 0 && (
                  <span className="text-orange-400">↓{status.behind}</span>
                )}
              </div>
            </div>

            {stagedFiles.length > 0 && (
              <div className="bg-slate-800 rounded">
                <div className="px-3 py-2 border-b border-slate-700 flex justify-between items-center">
                  <span className="text-green-400 text-sm font-medium">Staged Changes</span>
                  <button
                    type="button"
                    onClick={() => handleUnstage(stagedFiles.map((f) => f.path))}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    Unstage All
                  </button>
                </div>
                <div className="p-2">
                  {stagedFiles.map((file) => (
                    <div key={file.path} className="flex items-center gap-2 py-1 text-sm">
                      <span className={`font-mono ${statusColors[file.status] || ""}`}>
                        {file.status.toUpperCase().padEnd(8)}
                      </span>
                      <span className="text-slate-300">{file.path}</span>
                      <button
                        type="button"
                        onClick={() => handleUnstage([file.path])}
                        className="ml-auto text-xs text-slate-500 hover:text-white"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {unstagedFiles.length > 0 && (
              <div className="bg-slate-800 rounded">
                <div className="px-3 py-2 border-b border-slate-700 flex justify-between items-center">
                  <span className="text-yellow-400 text-sm font-medium">Unstaged Changes</span>
                  <button
                    type="button"
                    onClick={() => handleStage(unstagedFiles.map((f) => f.path))}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    Stage All
                  </button>
                </div>
                <div className="p-2">
                  {unstagedFiles.map((file) => (
                    <div key={file.path} className="flex items-center gap-2 py-1 text-sm">
                      <span className={`font-mono ${statusColors[file.status] || ""}`}>
                        {file.status.toUpperCase().padEnd(8)}
                      </span>
                      <span className="text-slate-300">{file.path}</span>
                      <button
                        type="button"
                        onClick={() => handleStage([file.path])}
                        className="ml-auto text-xs text-slate-500 hover:text-white"
                      >
                        +
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-slate-800 rounded p-3">
              <h3 className="text-sm font-medium mb-2">Commit</h3>
              <textarea
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="Commit message..."
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm mb-2 resize-none"
                rows={3}
              />
              <button
                type="button"
                onClick={handleCommit}
                disabled={loading || !commitMessage.trim() || stagedFiles.length === 0}
                className="px-4 py-2 bg-green-700 hover:bg-green-600 rounded text-sm disabled:opacity-50"
              >
                Commit
              </button>
            </div>
          </div>
        )}

        {activeTab === "branches" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-medium">Local & Remote Branches</h3>
              <button
                type="button"
                onClick={() => setShowNewBranch(!showNewBranch)}
                className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 rounded text-sm"
              >
                {showNewBranch ? "Cancel" : "New Branch"}
              </button>
            </div>

            {showNewBranch && (
              <div className="bg-slate-800 rounded p-3 flex gap-2">
                <input
                  type="text"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="branch-name"
                  className="flex-1 px-3 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm"
                />
                <button
                  type="button"
                  onClick={handleCreateBranch}
                  disabled={!newBranchName.trim()}
                  className="px-4 py-1.5 bg-green-700 hover:bg-green-600 rounded text-sm disabled:opacity-50"
                >
                  Create
                </button>
              </div>
            )}

            <div className="bg-slate-800 rounded">
              {branches.map((branch) => (
                <div
                  key={branch.name}
                  className="flex items-center gap-2 px-3 py-2 border-b border-slate-700 last:border-b-0"
                >
                  {branch.current && (
                    <span className="text-green-400">●</span>
                  )}
                  <span className={`font-mono text-sm ${branch.current ? "text-white" : "text-slate-400"}`}>
                    {branch.name}
                  </span>
                  {branch.remote && (
                    <span className="text-xs text-blue-400">remote</span>
                  )}
                  {!branch.current && !branch.remote && (
                    <button
                      type="button"
                      onClick={() => handleDeleteBranch(branch.name)}
                      className="ml-auto text-xs text-red-400 hover:text-red-300"
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
          <div className="bg-slate-800 rounded">
            {logs.map((log) => (
              <div
                key={log.hash}
                className="flex gap-4 px-3 py-3 border-b border-slate-700 last:border-b-0"
              >
                <span className="text-yellow-400 font-mono text-sm">{log.shortHash}</span>
                <div className="flex-1">
                  <div className="text-sm text-white">{log.message}</div>
                  <div className="text-xs text-slate-400 mt-1">
                    {log.author} · {new Date(log.date).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}