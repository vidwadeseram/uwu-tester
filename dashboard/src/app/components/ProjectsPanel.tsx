"use client";

import { useState } from "react";
import { ProjectsData } from "../page";

interface Props {
  data: ProjectsData | null;
  onRefresh: () => void;
}

function formatRelativeTime(iso: string): string {
  if (!iso) return "";
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    const diffS = Math.floor(diffMs / 1000);
    if (diffS < 60) return `${diffS}s ago`;
    const diffM = Math.floor(diffS / 60);
    if (diffM < 60) return `${diffM}m ago`;
    const diffH = Math.floor(diffM / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    return `${diffD}d ago`;
  } catch {
    return "";
  }
}

function truncateUrl(url: string, max = 50): string {
  if (!url) return "";
  if (url.length <= max) return url;
  return url.slice(0, max) + "…";
}

interface CloneFormProps {
  onClose: () => void;
  onCloned: () => void;
}

function CloneForm({ onClose, onCloned }: CloneFormProps) {
  const [url, setUrl] = useState("");
  const [dest, setDest] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleClone = async () => {
    if (!url.trim()) {
      setError("Git URL is required.");
      return;
    }
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), dest: dest.trim() || undefined }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess(`Cloned to ${data.path}`);
        setUrl("");
        setDest("");
        onCloned();
      } else {
        setError(data.message || "Clone failed.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="rounded p-3 space-y-2"
      style={{
        background: "rgba(30, 45, 74, 0.4)",
        border: "1px solid rgba(0, 212, 255, 0.2)",
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <span
          className="text-xs font-semibold uppercase tracking-widest"
          style={{ color: "#00d4ff" }}
        >
          Clone Repository
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs"
          style={{ color: "#4a5568" }}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <title>Close</title>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <input
        type="text"
        placeholder="https://github.com/user/repo.git"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className="w-full px-3 py-1.5 rounded text-xs outline-none"
        style={{
          background: "rgba(10, 14, 26, 0.8)",
          border: "1px solid rgba(30, 45, 74, 0.8)",
          color: "#e2e8f0",
        }}
        onFocus={(e) =>
          (e.currentTarget.style.borderColor = "rgba(0, 212, 255, 0.4)")
        }
        onBlur={(e) =>
          (e.currentTarget.style.borderColor = "rgba(30, 45, 74, 0.8)")
        }
      />

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          placeholder="Destination folder (optional)"
          value={dest}
          onChange={(e) => setDest(e.target.value)}
          className="flex-1 w-full px-3 py-1.5 rounded text-xs outline-none"
          style={{
            background: "rgba(10, 14, 26, 0.8)",
            border: "1px solid rgba(30, 45, 74, 0.8)",
            color: "#e2e8f0",
          }}
          onFocus={(e) =>
            (e.currentTarget.style.borderColor = "rgba(0, 212, 255, 0.4)")
          }
          onBlur={(e) =>
            (e.currentTarget.style.borderColor = "rgba(30, 45, 74, 0.8)")
          }
        />
        <button
          type="button"
          onClick={handleClone}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all flex-shrink-0"
          style={{
            background: loading
              ? "rgba(30, 45, 74, 0.5)"
              : "rgba(0, 212, 255, 0.12)",
            border: "1px solid rgba(0, 212, 255, 0.3)",
            color: loading ? "#4a5568" : "#00d4ff",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? (
            <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <title>Loading</title>
              <path d="M21 12a9 9 0 1 1-9-9" />
            </svg>
          ) : (
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <title>Clone repository</title>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          )}
          {loading ? "Cloning…" : "Clone"}
        </button>
      </div>

      {error && (
        <div className="text-xs px-2 py-1 rounded" style={{ background: "rgba(255, 68, 68, 0.1)", color: "#ff4444", border: "1px solid rgba(255, 68, 68, 0.2)" }}>
          {error}
        </div>
      )}
      {success && (
        <div className="text-xs px-2 py-1 rounded" style={{ background: "rgba(0, 255, 136, 0.1)", color: "#00ff88", border: "1px solid rgba(0, 255, 136, 0.2)" }}>
          {success}
        </div>
      )}
    </div>
  );
}

export default function ProjectsPanel({ data, onRefresh }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [showCloneForm, setShowCloneForm] = useState(false);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);

  const handleDeleteProject = async (projectPath: string, projectName: string) => {
    if (deletingPath) return;
    const ok = confirm(`Delete project "${projectName}" at ${projectPath}? This cannot be undone.`);
    if (!ok) return;
    setDeletingPath(projectPath);
    try {
      const res = await fetch("/api/projects", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message ?? "Failed to delete project");
        return;
      }
      onRefresh();
    } catch {
      alert("Network error while deleting project");
    } finally {
      setDeletingPath(null);
    }
  };

  const totalProjects = data?.projects?.length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Panel header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <svg
            className="w-4 h-4"
            style={{ color: "#ffd700" }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <title>Projects</title>
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <h2
            className="text-sm font-semibold uppercase tracking-widest"
            style={{ color: "#ffd700" }}
          >
            Projects
          </h2>
          <span
            className="badge"
            style={{
              background: "rgba(255, 215, 0, 0.1)",
              color: "#ffd700",
              border: "1px solid rgba(255, 215, 0, 0.2)",
            }}
          >
            {data === null ? "…" : totalProjects}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Clone button */}
          <button
            type="button"
            onClick={() => setShowCloneForm((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all"
            style={{
              background: showCloneForm
                ? "rgba(0, 212, 255, 0.18)"
                : "rgba(0, 212, 255, 0.08)",
              border: `1px solid ${showCloneForm ? "rgba(0, 212, 255, 0.5)" : "rgba(0, 212, 255, 0.2)"}`,
              color: "#00d4ff",
            }}
            onMouseEnter={(e) => {
              if (!showCloneForm) {
                e.currentTarget.style.background = "rgba(0, 212, 255, 0.15)";
                e.currentTarget.style.borderColor = "rgba(0, 212, 255, 0.4)";
              }
            }}
            onMouseLeave={(e) => {
              if (!showCloneForm) {
                e.currentTarget.style.background = "rgba(0, 212, 255, 0.08)";
                e.currentTarget.style.borderColor = "rgba(0, 212, 255, 0.2)";
              }
            }}
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <title>Add project</title>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Clone Project
          </button>

          {/* Collapse toggle */}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="flex items-center justify-center w-6 h-6 rounded transition-colors"
            style={{
              background: "rgba(30, 45, 74, 0.4)",
              border: "1px solid rgba(30, 45, 74, 0.8)",
              color: "#4a5568",
            }}
            title={collapsed ? "Expand" : "Collapse"}
          >
            <svg
              className="w-3.5 h-3.5 transition-transform"
              style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <title>Toggle projects panel</title>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </div>

      {/* Clone form inline */}
      {showCloneForm && !collapsed && (
        <CloneForm
          onClose={() => setShowCloneForm(false)}
          onCloned={() => {
            setShowCloneForm(false);
            onRefresh();
          }}
        />
      )}


      {/* Content */}
      {!collapsed && (
        <>
          {data === null ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="card animate-pulse" style={{ height: 72 }}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="w-7 h-7 rounded" style={{ background: "#1e2d4a" }} />
                    <div className="h-4 rounded" style={{ background: "#1e2d4a", width: "35%" }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (data.projects?.length ?? 0) === 0 ? (
            <div
              className="card flex flex-col items-center justify-center py-12 gap-3"
              style={{ color: "#4a5568" }}
            >
              <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <title>No projects</title>
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <div className="text-sm">No projects found</div>
              <div className="text-xs" style={{ color: "#2e4a7a" }}>
                Use &ldquo;Clone Project&rdquo; above to add a project
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {data.projects.map((proj) => (
                <ProjectRow
                  key={proj.path}
                  project={proj}
                  deleting={deletingPath === proj.path}
                  onDelete={() => handleDeleteProject(proj.path, proj.name)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ProjectRow({
  project,
  deleting,
  onDelete,
}: {
  project: { name: string; path: string; lastModified: string; branch: string; remoteUrl: string };
  deleting: boolean;
  onDelete: () => void;
}) {
  const terminalUrl = "/terminal/";

  return (
    <div
      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-3 py-2.5 rounded"
      style={{
        background: "rgba(30, 45, 74, 0.3)",
        border: "1px solid rgba(30, 45, 74, 0.5)",
      }}
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        {/* Name + branch */}
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="font-mono font-semibold text-sm"
            style={{ color: "#e2e8f0" }}
          >
            {project.name}
          </span>
          {project.branch && (
            <span
              className="badge"
              style={{
                background: "rgba(0, 255, 136, 0.08)",
                color: "#00ff88",
                border: "1px solid rgba(0, 255, 136, 0.2)",
              }}
            >
              <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <title>Branch</title>
                <line x1="6" y1="3" x2="6" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
              {project.branch}
            </span>
          )}
          {project.lastModified && (
            <span className="text-xs" style={{ color: "#4a5568" }}>
              {formatRelativeTime(project.lastModified)}
            </span>
          )}
        </div>

        {/* Remote URL */}
        {project.remoteUrl && (
          <span
            className="font-mono text-xs truncate"
            style={{ color: "#94a3b8" }}
            title={project.remoteUrl}
          >
            {truncateUrl(project.remoteUrl)}
          </span>
        )}

        {/* Path */}
        <span className="font-mono text-xs" style={{ color: "#2e4a7a" }}>
          {project.path}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap sm:justify-end">
        {/* Open Terminal button */}
        <a
          href={terminalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all"
          style={{
            background: "rgba(0, 255, 136, 0.08)",
            border: "1px solid rgba(0, 255, 136, 0.2)",
            color: "#00ff88",
            textDecoration: "none",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(0, 255, 136, 0.16)";
            e.currentTarget.style.borderColor = "rgba(0, 255, 136, 0.4)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(0, 255, 136, 0.08)";
            e.currentTarget.style.borderColor = "rgba(0, 255, 136, 0.2)";
          }}
        >
          <svg
            className="w-3 h-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <title>Open terminal</title>
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          Terminal
        </a>

        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all"
          style={{
            background: deleting ? "rgba(30,45,74,0.5)" : "rgba(255,68,68,0.1)",
            border: "1px solid rgba(255,68,68,0.3)",
            color: deleting ? "#4a5568" : "#ff4444",
          }}
          title="Delete project"
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>
    </div>
  );
}
