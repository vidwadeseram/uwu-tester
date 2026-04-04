"use client";

import { useEffect, useState, useCallback } from "react";

interface Script {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  content: string;
  isFavorite: boolean;
  lastRunAt: string | null;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

interface Project {
  id: string;
  name: string;
  path: string;
}

export default function ScriptsPage() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [showNewScript, setShowNewScript] = useState(false);
  const [newScript, setNewScript] = useState({ name: "", description: "", content: "" });
  const [editingScript, setEditingScript] = useState<Script | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const loadScripts = useCallback(async () => {
    try {
      const url = selectedProjectId
        ? `/api/scripts?projectId=${selectedProjectId}`
        : "/api/scripts";
      const res = await fetch(url);
      const data = await res.json();
      setScripts(data.scripts || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    fetch("/api/projects")
      .then((res) => res.json())
      .then((data) => {
        if (data.projects && data.projects.length > 0) {
          setProjects(data.projects);
          setSelectedProjectId(data.projects[0].id);
        } else {
          setLoading(false);
        }
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      loadScripts();
    }
  }, [selectedProjectId, loadScripts]);

  const handleCreate = async () => {
    if (!newScript.name.trim() || !newScript.content.trim() || !selectedProjectId) return;
    try {
      const res = await fetch("/api/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newScript, projectId: selectedProjectId }),
      });
      if (res.ok) {
        setNewScript({ name: "", description: "", content: "" });
        setShowNewScript(false);
        loadScripts();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdate = async (script: Script) => {
    try {
      await fetch(`/api/scripts/${script.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(script),
      });
      setEditingScript(null);
      loadScripts();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/scripts/${id}`, { method: "DELETE" });
      loadScripts();
    } catch (err) {
      console.error(err);
    }
  };

  const handleRun = async (script: Script) => {
    setRunning(script.id);
    setOutput(null);
    try {
      const res = await fetch(`/api/scripts/${script.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worktreeId: null }),
      });
      const data = await res.json();
      setOutput(data.output || data.error || "Script completed");
    } catch (err) {
      setOutput("Execution failed");
      console.error(err);
    } finally {
      setRunning(null);
    }
  };

  const handleToggleFavorite = async (script: Script) => {
    try {
      await fetch(`/api/scripts/${script.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFavorite: !script.isFavorite }),
      });
      loadScripts();
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: "var(--bg)", color: "var(--text)" }}>
        Loading...
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4" style={{ background: "var(--bg)", color: "var(--dim)" }}>
        <svg className="w-16 h-16 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <title>No projects</title>
          <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
        </svg>
        <div className="text-center">
          <div className="text-lg font-semibold mb-1" style={{ color: "var(--text)" }}>No Projects Found</div>
          <div className="text-sm">Add a project from the Dashboard to use Scripts.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <h1 className="text-lg font-semibold">Saved Scripts</h1>
        <div className="flex items-center gap-4">
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="px-3 py-1.5 rounded text-sm"
            style={{ background: "rgba(30,45,74,0.5)", border: "1px solid var(--border)", color: "var(--text)" }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowNewScript(true)}
            className="px-4 py-2 rounded text-sm font-medium"
            style={{ background: "rgba(0,212,255,0.15)", color: "var(--cyan)", border: "1px solid rgba(0,212,255,0.3)" }}
          >
            + New Script
          </button>
        </div>
      </div>

      {showNewScript && (
        <div className="p-4 border-b space-y-3" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <input
            type="text"
            value={newScript.name}
            onChange={(e) => setNewScript({ ...newScript, name: e.target.value })}
            placeholder="Script name..."
            className="w-full px-3 py-2 rounded text-sm"
            style={{ background: "rgba(10,14,26,0.8)", border: "1px solid var(--border)", color: "var(--text)" }}
          />
          <input
            type="text"
            value={newScript.description}
            onChange={(e) => setNewScript({ ...newScript, description: e.target.value })}
            placeholder="Description (optional)..."
            className="w-full px-3 py-2 rounded text-sm"
            style={{ background: "rgba(10,14,26,0.8)", border: "1px solid var(--border)", color: "var(--text)" }}
          />
          <textarea
            value={newScript.content}
            onChange={(e) => setNewScript({ ...newScript, content: e.target.value })}
            placeholder={"#!/bin/bash\necho 'Hello world'"}
            className="w-full px-3 py-2 rounded text-sm font-mono resize-none"
            style={{ background: "rgba(10,14,26,0.8)", border: "1px solid var(--border)", color: "var(--text)" }}
            rows={5}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCreate}
              className="px-4 py-2 rounded text-sm font-medium"
              style={{ background: "rgba(0,255,136,0.15)", color: "var(--green)", border: "1px solid rgba(0,255,136,0.3)" }}
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowNewScript(false)}
              className="px-4 py-2 rounded text-sm"
              style={{ background: "rgba(30,45,74,0.4)", color: "var(--dim)", border: "1px solid var(--border)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="w-1/2 p-4 overflow-y-auto border-r" style={{ borderColor: "var(--border)" }}>
          <div className="space-y-2">
            {scripts.map((script) => (
              <div
                key={script.id}
                className="rounded p-4 transition-colors"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}
              >
                {editingScript?.id === script.id ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editingScript.name}
                      onChange={(e) => setEditingScript({ ...editingScript, name: e.target.value })}
                      className="w-full px-2 py-1 rounded text-sm"
                      style={{ background: "rgba(10,14,26,0.8)", border: "1px solid var(--border)", color: "var(--text)" }}
                    />
                    <textarea
                      value={editingScript.content}
                      onChange={(e) => setEditingScript({ ...editingScript, content: e.target.value })}
                      className="w-full px-2 py-1 rounded text-sm font-mono resize-none"
                      style={{ background: "rgba(10,14,26,0.8)", border: "1px solid var(--border)", color: "var(--text)" }}
                      rows={5}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleUpdate(editingScript)}
                        className="px-2 py-1 rounded text-xs font-medium"
                        style={{ background: "rgba(0,255,136,0.15)", color: "var(--green)", border: "1px solid rgba(0,255,136,0.3)" }}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingScript(null)}
                        className="px-2 py-1 rounded text-xs"
                        style={{ background: "rgba(30,45,74,0.4)", color: "var(--dim)", border: "1px solid var(--border)" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium" style={{ color: "var(--text)" }}>{script.name}</span>
                          {script.isFavorite && <span style={{ color: "var(--yellow)" }}>★</span>}
                        </div>
                        {script.description && (
                          <div className="text-sm mt-1" style={{ color: "var(--dim)" }}>{script.description}</div>
                        )}
                        <div className="text-xs mt-2" style={{ color: "#4a5568" }}>
                          Run count: {script.runCount}
                          {script.lastRunAt && (
                            <> · Last run: {new Date(script.lastRunAt).toLocaleDateString()}</>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
                      <button
                        type="button"
                        onClick={() => handleRun(script)}
                        disabled={running === script.id}
                        className="px-3 py-1 rounded text-xs disabled:opacity-50 font-medium"
                        style={{ background: "rgba(0,255,136,0.15)", color: "var(--green)", border: "1px solid rgba(0,255,136,0.3)" }}
                      >
                        {running === script.id ? "Running..." : "▶ Run"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingScript(script)}
                        className="px-3 py-1 rounded text-xs"
                        style={{ background: "rgba(30,45,74,0.4)", color: "var(--dim)", border: "1px solid var(--border)" }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleFavorite(script)}
                        className="px-3 py-1 rounded text-xs"
                        style={{ background: "rgba(30,45,74,0.4)", color: script.isFavorite ? "var(--yellow)" : "var(--dim)", border: "1px solid var(--border)" }}
                      >
                        {script.isFavorite ? "★" : "☆"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(script.id)}
                        className="px-3 py-1 rounded text-xs"
                        style={{ background: "rgba(255,68,68,0.08)", color: "var(--red)", border: "1px solid rgba(255,68,68,0.2)" }}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {scripts.length === 0 && (
              <div className="text-center py-8" style={{ color: "var(--dim)" }}>
                No scripts yet. Create one to get started!
              </div>
            )}
          </div>
        </div>

        <div className="w-1/2 p-4 overflow-y-auto">
          <h3 className="text-sm font-medium mb-2" style={{ color: "var(--dim)" }}>Output</h3>
          <pre className="rounded p-4 text-sm font-mono whitespace-pre-wrap" style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text)" }}>
            {output || "Run a script to see output here..."}
          </pre>
        </div>
      </div>
    </div>
  );
}
