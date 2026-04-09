"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { FileTree, FileNode } from "@/components/file-explorer/FileTree";
import { DiffViewer } from "@/components/file-explorer/DiffViewer";
import { VscNewFolder } from "react-icons/vsc";

const MonacoEditor = dynamic(() => import("@/components/file-explorer/MonacoEditor"), { ssr: false });

interface Project {
  id: string;
  name: string;
  path: string;
}

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 600;
const DEFAULT_SIDEBAR_WIDTH = 280;
const MOBILE_BREAKPOINT = 768;

export default function FilesPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [tree, setTree] = useState<FileNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [, setDiff] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");
  const [showDiff, setShowDiff] = useState(false);
  const [diffMode, setDiffMode] = useState<"inline" | "side-by-side">("inline");
  const [error, setError] = useState<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [newFolderTrigger, setNewFolderTrigger] = useState(0);

  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isDragging = useRef(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("fileExplorerSidebarWidth");
    if (saved) {
      const width = parseInt(saved, 10);
      if (width >= SIDEBAR_MIN_WIDTH && width <= SIDEBAR_MAX_WIDTH) {
        setSidebarWidth(width);
      }
    }
  }, []);

  const saveSidebarWidth = useCallback((width: number) => {
    localStorage.setItem("fileExplorerSidebarWidth", String(width));
    setSidebarWidth(width);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const newWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, e.clientX));
      saveSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [saveSidebarWidth]);

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    setProjectsLoading(true);
    fetch("/api/projects")
      .then((res) => res.json())
      .then((data) => {
        if (data.projects && data.projects.length > 0) {
          setProjects(data.projects);
          setSelectedProjectId(data.projects[0].id);
        } else {
          setProjects([]);
          setSelectedProjectId("");
        }
      })
      .catch((e) => {
        console.error(e);
        setProjects([]);
        setSelectedProjectId("");
      })
      .finally(() => setProjectsLoading(false));
  }, []);

  const loadTree = useCallback(async (projectId: string) => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/files/tree?projectId=${projectId}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setTree([]);
      } else {
        setTree(data.tree || []);
      }
    } catch (err) {
      setError("Failed to load file tree");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFile = useCallback(async (projectId: string, path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/files/content?projectId=${projectId}&path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setFileContent("");
        setOriginalContent("");
      } else {
        setFileContent(data.content || "");
        setOriginalContent(data.content || "");
      }
    } catch (err) {
      setError("Failed to load file");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDiff = useCallback(async (projectId: string, path: string) => {
    try {
      const res = await fetch(`/api/files/diff?projectId=${projectId}&path=${encodeURIComponent(path)}`);
      const data = await res.json();
      setDiff(data.diff || "");
    } catch (err) {
      console.error(err);
    }
  }, []);

  const handleMove = useCallback(async (sourcePath: string, destDir: string) => {
    if (!selectedProjectId) return;
    try {
      const res = await fetch("/api/files/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selectedProjectId, sourcePath, destinationDir: destDir }),
      });
      const data = await res.json();
      if (data.success) {
        loadTree(selectedProjectId);
      } else {
        setError(data.error || "Failed to move file");
      }
    } catch (err) {
      setError("Failed to move file");
      console.error(err);
    }
  }, [selectedProjectId, loadTree]);

  const handleCreateFolder = useCallback(async (parentDir: string, name: string) => {
    if (!selectedProjectId || !name) return;
    const dirPath = parentDir ? `${parentDir}/${name}` : name;
    try {
      const res = await fetch("/api/files/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selectedProjectId, dirPath }),
      });
      const data = await res.json();
      if (data.success) {
        loadTree(selectedProjectId);
      } else {
        setError(data.error || "Failed to create folder");
      }
    } catch (err) {
      setError("Failed to create folder");
      console.error(err);
    }
  }, [selectedProjectId, loadTree]);

  useEffect(() => {
    if (selectedProjectId) {
      loadTree(selectedProjectId);
    }
  }, [selectedProjectId, loadTree]);

  const handleSelect = useCallback(
    (path: string) => {
      setSelectedPath(path);
      loadFile(selectedProjectId, path);
      loadDiff(selectedProjectId, path);
      setShowDiff(false);
      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [selectedProjectId, loadFile, loadDiff, isMobile]
  );

  const handleSave = async () => {
    if (!selectedProjectId || !selectedPath) return;
    setSaving(true);
    try {
      const res = await fetch("/api/files/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: selectedProjectId,
          path: selectedPath,
          content: fileContent,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setOriginalContent(fileContent);
        loadTree(selectedProjectId);
      }
    } catch (err) {
      setError("Failed to save file");
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = fileContent !== originalContent;

  return (
    <div className="h-screen flex flex-col fade-in" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <div className="flex items-center gap-2 px-4 py-3 flex-wrap" style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}>
        <button
          type="button"
          onClick={() => isMobile ? setSidebarOpen(!sidebarOpen) : setSidebarCollapsed(!sidebarCollapsed)}
          className="p-2 rounded flex-none"
          style={{ background: "var(--btn-bg)", color: "var(--text)", border: "1px solid var(--border)" }}
          aria-label={isMobile ? (sidebarOpen ? "Close file tree" : "Open file tree") : (sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar")}
        >
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 18, height: 18 }} aria-hidden="true">
            {isMobile && sidebarOpen ? (
              <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            ) : (
              <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            )}
          </svg>
        </button>
        <h1 className="text-lg font-semibold flex-none" style={{ color: "var(--text)" }}>File Explorer</h1>
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          className="px-3 py-1.5 rounded text-sm flex-none"
          style={{ background: "var(--btn-bg)", color: "var(--text)", border: "1px solid var(--border)" }}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Filter files..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="px-3 py-1.5 rounded text-sm flex-1 min-w-0 max-w-xs"
          style={{ background: "var(--btn-bg)", color: "var(--text)", border: "1px solid var(--border)" }}
        />
        {selectedProjectId && (
          <button
            type="button"
            onClick={() => setNewFolderTrigger((n) => n + 1)}
            className="flex items-center gap-1 px-3 py-1.5 rounded text-sm flex-none"
            style={{ background: "var(--btn-bg)", color: "var(--text)", border: "1px solid var(--border)" }}
            title="New Folder"
          >
            <VscNewFolder size={14} />
            <span className="hidden sm:inline">New Folder</span>
          </button>
        )}
        {selectedPath && (
          <>
            <button
              type="button"
              onClick={() => setShowDiff(!showDiff)}
              className="px-3 py-1.5 rounded text-sm flex-none"
              style={{ background: "var(--btn-bg)", color: "var(--text)", border: "1px solid var(--border)" }}
            >
              {showDiff ? "Hide Diff" : "Show Diff"}
            </button>
            {showDiff && (
              <button
                type="button"
                onClick={() => setDiffMode(diffMode === "inline" ? "side-by-side" : "inline")}
                className="px-3 py-1.5 rounded text-sm flex-none"
                style={{ background: "var(--btn-bg)", color: "var(--text)", border: "1px solid var(--border)" }}
              >
                {diffMode === "inline" ? "Side by Side" : "Inline"}
              </button>
            )}
            {hasChanges && (
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-1.5 rounded text-sm disabled:opacity-50 flex-none"
                style={{ background: "rgba(0,255,136,.15)", color: "var(--green)", border: "1px solid var(--green)" }}
              >
                {saving ? (
                  <span className="spinner w-3 h-3 inline-block" style={{ border: "1.5px solid rgba(0,255,136,0.3)", borderTopColor: "var(--green)" }} />
                ) : "Save"}
              </button>
            )}
          </>
        )}
      </div>

      {error && (
        <div className="px-4 py-2" style={{ background: "rgba(255,0,0,.15)", color: "var(--red)" }}>
          {error}
        </div>
      )}

      {projects.length === 0 && !projectsLoading ? (
        <div style={{ display: "grid", placeItems: "center", flex: 1 }}>
          <span style={{ color: "var(--dim)" }}>No projects found. Add a project from the Dashboard.</span>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {isMobile && sidebarOpen && (
            <div
              className="fixed inset-0 bg-black/50 z-40"
              onClick={() => setSidebarOpen(false)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Escape" && setSidebarOpen(false)}
              aria-label="Close sidebar"
            />
          )}

          <div
            className="flex-none h-full flex flex-col overflow-hidden"
            style={{
              width: isMobile
                ? (sidebarOpen ? "280px" : "0")
                : (sidebarCollapsed ? "0" : `${sidebarWidth}px`),
              borderRight: "1px solid var(--border)",
              transition: isMobile || sidebarCollapsed ? "width 0.2s ease" : "none",
              flexShrink: 0,
            }}
          >
            <div className="flex-1 overflow-auto p-2">
              {loading && tree.length === 0 ? (
                <div className="flex flex-col gap-2 p-2">
                  {[70, 55, 80, 45, 65, 60].map((w, i) => (
                    <div key={`skeleton-${i}`} className="skeleton h-3" style={{ width: `${w}%`, animationDelay: `${i * 0.07}s` }} />
                  ))}
                </div>
              ) : tree.length === 0 ? (
                <div style={{ color: "var(--dim)" }}>No files found</div>
              ) : (
                <FileTree
                  nodes={tree}
                  selectedPath={selectedPath}
                  onSelect={handleSelect}
                  filter={filter}
                  projectId={selectedProjectId}
                  onMove={handleMove}
                  onCreateFolder={handleCreateFolder}
                  onRefresh={() => loadTree(selectedProjectId)}
                  triggerNewFolder={newFolderTrigger}
                />
              )}
            </div>
          </div>

          {!isMobile && !sidebarCollapsed && (
            <div
              onMouseDown={startDrag}
              className="w-1 flex-none h-full cursor-col-resize z-10 transition-colors"
              style={{ background: "var(--border)" }}
              onMouseOver={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--cyan)"; }}
              onMouseOut={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--border)"; }}
              role="slider"
              aria-label="Resize sidebar"
              aria-valuemin={SIDEBAR_MIN_WIDTH}
              aria-valuemax={SIDEBAR_MAX_WIDTH}
              aria-valuenow={sidebarWidth}
              tabIndex={0}
            />
          )}

          <div className="flex-1 flex overflow-hidden">
            <div
              className="overflow-hidden border-r"
              style={{
                width: showDiff ? (isMobile ? "50%" : "33.333%") : "0",
                borderColor: "var(--border)",
                transition: "width 0.2s ease",
                display: showDiff ? "block" : "none",
                flexShrink: 0,
              }}
            >
              <DiffViewer oldContent={originalContent} newContent={fileContent} mode={diffMode} />
            </div>

            <div className="flex-1 overflow-hidden">
              {selectedPath ? (
                <div className="h-full flex flex-col">
                  <div className="px-4 py-2" style={{ background: "var(--card)", borderBottom: "1px solid var(--border)", color: "var(--dim)" }}>
                    {selectedPath}
                  </div>
                  <div className="flex-1">
                    <MonacoEditor value={fileContent} onChange={(val) => setFileContent(val || "")} path={selectedPath} />
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center" style={{ color: "var(--dim)" }}>
                  Select a file to edit
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
