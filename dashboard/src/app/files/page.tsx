"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { FileTree, FileNode } from "@/components/file-explorer/FileTree";
import { DiffViewer } from "@/components/file-explorer/DiffViewer";

const MonacoEditor = dynamic(() => import("@/components/file-explorer/MonacoEditor"), { ssr: false });

interface Project {
  id: string;
  name: string;
  path: string;
}

export default function FilesPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [tree, setTree] = useState<FileNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [diff, setDiff] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");
  const [showDiff, setShowDiff] = useState(false);
  const [diffMode, setDiffMode] = useState<"inline" | "side-by-side">("inline");
  const [error, setError] = useState<string | null>(null);

  const [projectsLoading, setProjectsLoading] = useState(true);

  useEffect(() => {
    // Load projects on mount. If no projects exist we show a friendly empty state.
    setProjectsLoading(true);
    fetch("/api/projects")
      .then((res) => res.json())
      .then((data) => {
        if (data.projects && data.projects.length > 0) {
          setProjects(data.projects);
          setSelectedProjectId(data.projects[0].id);
        } else {
          // No projects returned
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
    },
    [selectedProjectId, loadFile, loadDiff]
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
    <div className="h-screen flex flex-col" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <div className="flex items-center gap-4 px-4 py-3" style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}>
        <h1 className="text-lg font-semibold" style={{ color: "var(--text)" }}>File Explorer</h1>
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          className="px-3 py-1.5 rounded text-sm"
          style={{ background: "rgba(30,45,74,.5)", borderColor: "var(--border)" }}
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
          className="px-3 py-1.5 rounded text-sm flex-1 max-w-xs"
          style={{ background: "rgba(30,45,74,.5)", borderColor: "var(--border)" }}
        />
        {selectedPath && (
          <>
            <button
              type="button"
              onClick={() => setShowDiff(!showDiff)}
              className="px-3 py-1.5 rounded text-sm"
              style={{ background: "rgba(30,45,74,.5)", borderColor: "var(--border)" }}
            >
              {showDiff ? "Hide Diff" : "Show Diff"}
            </button>
            {showDiff && (
              <button
                type="button"
                onClick={() => setDiffMode(diffMode === "inline" ? "side-by-side" : "inline")}
                className="px-3 py-1.5 rounded text-sm"
                style={{ background: "rgba(30,45,74,.5)", borderColor: "var(--border)" }}
              >
                {diffMode === "inline" ? "Side by Side" : "Inline"}
              </button>
            )}
            {hasChanges && (
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-1.5 rounded text-sm disabled:opacity-50"
                style={{ background: "rgba(0,255,136,.2)", color: "var(--green)", border: "1px solid var(--green)" }}
              >
                {saving ? "Saving..." : "Save"}
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
        <div style={{ display: 'grid', placeItems: 'center', flex: 1 }}>
          <span style={{ color: "var(--dim)" }}>No projects found. Add a project from the Dashboard.</span>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-4 gap-0 overflow-hidden">
          <div className="col-span-1 overflow-hidden border-r" style={{ borderColor: 'var(--border)' }}>
            <div className="h-full overflow-auto p-2" style={{ overflow: 'auto' }}>
              {loading && tree.length === 0 ? (
                <div style={{ color: 'var(--dim)' }}>Loading...</div>
              ) : tree.length === 0 ? (
                <div style={{ color: 'var(--dim)' }}>No files found</div>
              ) : (
                <FileTree
                  nodes={tree}
                  selectedPath={selectedPath}
                  onSelect={handleSelect}
                  filter={filter}
                />
              )}
            </div>
          </div>

          <div className="col-span-1 overflow-hidden border-r" style={{ display: showDiff ? 'block' : 'none', borderColor: 'var(--border)' }}>
            <DiffViewer oldContent={originalContent} newContent={fileContent} mode={diffMode} />
          </div>

          <div className={`${showDiff ? "col-span-2" : "col-span-3"} overflow-hidden`}>
            {selectedPath ? (
              <div className="h-full flex flex-col">
                <div className="px-4 py-2" style={{ background: 'var(--card)', borderBottom: '1px solid var(--border)', color: 'var(--dim)' }}>
                  {selectedPath}
                </div>
                <div className="flex-1">
                  <MonacoEditor
                    value={fileContent}
                    onChange={(val) => setFileContent(val || "")}
                    path={selectedPath}
                  />
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center" style={{ color: 'var(--dim)' }}>
                Select a file to edit
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
