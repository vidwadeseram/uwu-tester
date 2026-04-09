"use client";

import { useEffect, useState, useCallback, useRef } from "react";

interface Project {
  id: string;
  name: string;
  path: string;
  branch?: string;
  folderName?: string | null;
}

interface Space {
  id: string;
  name: string;
  description: string | null;
  color: string;
  position: number;
  projects: Project[];
  createdAt: string;
  updatedAt: string;
}

interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
}

const COLORS = ["#00ff88", "#ff6b6b", "#4ecdc4", "#ffe66d", "#a855f7", "#3b82f6", "#f97316", "#ec4899"];

const INPUT_STYLE = {
  background: "var(--input-bg)",
  border: "1px solid var(--input-border)",
  color: "var(--text)",
  borderRadius: "6px",
  padding: "6px 10px",
  fontSize: "0.8rem",
  outline: "none",
  width: "100%",
} as const;

export default function SpacesPage() {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewSpace, setShowNewSpace] = useState(false);
  const [editingSpace, setEditingSpace] = useState<Space | null>(null);
  const [addingToSpace, setAddingToSpace] = useState<Space | null>(null);
  const [addProjectId, setAddProjectId] = useState("");
  const [addFolderName, setAddFolderName] = useState("");
  const [newSpace, setNewSpace] = useState({ name: "", description: "", color: "#00ff88" });

  const loadSpaces = useCallback(async () => {
    try {
      const res = await fetch("/api/spaces");
      const data = await res.json();
      setSpaces(data.spaces || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      setProjects(data.projects || []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    loadSpaces();
    loadProjects();
  }, [loadSpaces, loadProjects]);

  const handleCreateSpace = async () => {
    if (!newSpace.name.trim()) return;
    try {
      const res = await fetch("/api/spaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSpace),
      });
      if (res.ok) {
        setNewSpace({ name: "", description: "", color: "#00ff88" });
        setShowNewSpace(false);
        loadSpaces();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateSpace = async () => {
    if (!editingSpace) return;
    try {
      const res = await fetch(`/api/spaces/${editingSpace.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editingSpace.name,
          description: editingSpace.description,
          color: editingSpace.color,
        }),
      });
      if (res.ok) {
        setEditingSpace(null);
        loadSpaces();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteSpace = async (id: string) => {
    try {
      await fetch(`/api/spaces/${id}`, { method: "DELETE" });
      loadSpaces();
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddProject = async (spaceId: string) => {
    if (!addProjectId) return;
    try {
      const res = await fetch(`/api/spaces/${spaceId}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: addProjectId,
          folderName: addFolderName.trim() || null,
        }),
      });
      if (res.ok) {
        setAddingToSpace(null);
        setAddProjectId("");
        setAddFolderName("");
        loadSpaces();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleMoveToFolder = async (spaceId: string, projectId: string, folderName: string | null) => {
    try {
      await fetch(`/api/spaces/${spaceId}/projects`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, folderName }),
      });
      loadSpaces();
    } catch (err) {
      console.error(err);
    }
  };

  const handleRemoveProject = async (spaceId: string, projectId: string) => {
    try {
      await fetch(`/api/spaces/${spaceId}/projects?projectId=${projectId}`, { method: "DELETE" });
      loadSpaces();
    } catch (err) {
      console.error(err);
    }
  };

  const getProjectsNotInSpace = (space: Space) =>
    projects.filter((p) => !space.projects.some((sp) => sp.id === p.id));

  const getFolders = (space: Space): string[] => {
    const names = space.projects
      .map((p) => p.folderName)
      .filter((n): n is string => typeof n === "string" && n.trim().length > 0);
    return [...new Set(names)].sort();
  };

  const getUngrouped = (space: Space) =>
    space.projects.filter((p) => !p.folderName);

  const getInFolder = (space: Space, folder: string) =>
    space.projects.filter((p) => p.folderName === folder);

  if (loading) {
    return (
      <div className="max-w-screen-xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="skeleton w-9 h-9 rounded" />
            <div className="flex flex-col gap-2">
              <div className="skeleton h-5 w-24" />
              <div className="skeleton h-3 w-48" />
            </div>
          </div>
          <div className="skeleton h-8 w-28 rounded" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card p-4 space-y-3" style={{ animationDelay: `${i * 0.08}s` }}>
              <div className="skeleton h-5 w-32" />
              <div className="skeleton h-3 w-full" />
              <div className="skeleton h-3 w-3/4" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-screen-xl mx-auto px-4 py-6 space-y-6 fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded flex items-center justify-center"
            style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)" }}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <title>Spaces</title>
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: "#6366f1" }}>Spaces</h1>
            <p className="text-xs" style={{ color: "#4a5568" }}>Organize repos into workspaces with folders</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowNewSpace((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-opacity hover:opacity-80"
          style={{ background: "rgba(99,102,241,0.12)", color: "#6366f1", border: "1px solid rgba(99,102,241,0.3)" }}
        >
          {showNewSpace ? "✕ Cancel" : "+ New Space"}
        </button>
      </div>

      {showNewSpace && (
        <div className="card p-4 space-y-3" style={{ border: "1px solid rgba(99,102,241,0.3)" }}>
          <div className="text-sm font-semibold" style={{ color: "#6366f1" }}>New Space</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              value={newSpace.name}
              onChange={(e) => setNewSpace({ ...newSpace, name: e.target.value })}
              placeholder="Space name..."
              style={INPUT_STYLE}
              onKeyDown={(e) => e.key === "Enter" && handleCreateSpace()}
            />
            <input
              type="text"
              value={newSpace.description}
              onChange={(e) => setNewSpace({ ...newSpace, description: e.target.value })}
              placeholder="Description (optional)..."
              style={INPUT_STYLE}
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs" style={{ color: "#4a5568" }}>Color:</span>
            <div className="flex gap-1.5">
              {COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setNewSpace({ ...newSpace, color })}
                  className="w-5 h-5 rounded-full transition-transform hover:scale-110"
                  style={{ backgroundColor: color, outline: newSpace.color === color ? `2px solid ${color}` : "none", outlineOffset: "2px" }}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleCreateSpace}
              disabled={!newSpace.name.trim()}
              className="px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50"
              style={{ background: "rgba(99,102,241,0.15)", color: "#6366f1", border: "1px solid rgba(99,102,241,0.3)" }}
            >
              Create Space
            </button>
            <button
              type="button"
              onClick={() => setShowNewSpace(false)}
              className="px-4 py-1.5 rounded text-sm"
              style={{ background: "var(--btn-bg)", color: "var(--dim)", border: "1px solid var(--input-border)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {spaces.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-20 gap-3" style={{ color: "#4a5568" }}>
          <svg className="w-12 h-12 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <div className="text-sm">No spaces yet</div>
          <div className="text-xs" style={{ color: "#4a5568" }}>Create a space to group your repos into folders</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {spaces.map((space, spaceIdx) => {
            const folders = getFolders(space);
            const ungrouped = getUngrouped(space);
            const isEditing = editingSpace?.id === space.id;
            const isAdding = addingToSpace?.id === space.id;

            return (
              <div
                key={space.id}
                className="card overflow-hidden flex flex-col slide-up"
                style={{ borderTop: `3px solid ${space.color}`, "--i": spaceIdx } as React.CSSProperties}
              >
                {isEditing ? (
                  <div className="p-4 space-y-3">
                    <input
                      type="text"
                      value={editingSpace.name}
                      onChange={(e) => setEditingSpace({ ...editingSpace, name: e.target.value })}
                      style={INPUT_STYLE}
                      placeholder="Space name..."
                    />
                    <input
                      type="text"
                      value={editingSpace.description || ""}
                      onChange={(e) => setEditingSpace({ ...editingSpace, description: e.target.value })}
                      placeholder="Description..."
                      style={INPUT_STYLE}
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-xs" style={{ color: "#4a5568" }}>Color:</span>
                      <div className="flex gap-1">
                        {COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => setEditingSpace({ ...editingSpace, color })}
                            className="w-5 h-5 rounded-full"
                            style={{ backgroundColor: color, outline: editingSpace.color === color ? `2px solid ${color}` : "none", outlineOffset: "2px" }}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={handleUpdateSpace} className="px-3 py-1.5 rounded text-xs font-medium" style={{ background: "rgba(0,255,136,0.15)", color: "#00ff88", border: "1px solid rgba(0,255,136,0.3)" }}>Save</button>
                      <button type="button" onClick={() => setEditingSpace(null)} className="px-3 py-1.5 rounded text-xs" style={{ background: "var(--btn-bg)", color: "var(--dim)", border: "1px solid var(--input-border)" }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-8 h-8 rounded flex items-center justify-center text-sm font-bold flex-shrink-0"
                          style={{ backgroundColor: space.color + "20", color: space.color }}
                        >
                          {space.name.charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="font-semibold text-sm truncate" style={{ color: "var(--text)" }}>{space.name}</div>
                          {space.description && (
                            <div className="text-xs truncate" style={{ color: "#4a5568" }}>{space.description}</div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <button type="button" aria-label="Edit space" onClick={() => setEditingSpace(space)} className="px-2 py-1 text-xs rounded" style={{ color: "#4a5568" }} onMouseEnter={(e) => (e.currentTarget.style.color = "var(--dim)")} onMouseLeave={(e) => (e.currentTarget.style.color = "#4a5568")}>Edit</button>
                        <button type="button" aria-label="Delete space" onClick={() => handleDeleteSpace(space.id)} className="px-2 py-1 text-xs rounded" style={{ color: "#4a5568" }} onMouseEnter={(e) => (e.currentTarget.style.color = "#ff4444")} onMouseLeave={(e) => (e.currentTarget.style.color = "#4a5568")}>Delete</button>
                      </div>
                    </div>

                    <div className="px-4 pb-3 space-y-3 flex-1">
                      {folders.map((folder) => {
                        const folderProjects = getInFolder(space, folder);
                        return (
                          <div key={folder} className="rounded overflow-hidden" style={{ border: "1px solid var(--surface)" }}>
                            <div
                              className="flex items-center justify-between px-3 py-1.5"
                              style={{ background: "var(--btn-bg)", borderBottom: "1px solid var(--surface)" }}
                            >
                              <div className="flex items-center gap-1.5">
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke={space.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                                </svg>
                                <span className="text-xs font-semibold" style={{ color: space.color }}>{folder}</span>
                                <span className="text-xs" style={{ color: "#4a5568" }}>({folderProjects.length})</span>
                              </div>
                            </div>
                            <div className="divide-y" style={{ borderColor: "var(--btn-bg)" }}>
                              {folderProjects.map((project) => (
                                <ProjectRow
                                  key={project.id}
                                  project={project}
                                  space={space}
                                  folders={folders}
                                  onRemove={() => handleRemoveProject(space.id, project.id)}
                                  onMoveToFolder={(fn) => handleMoveToFolder(space.id, project.id, fn)}
                                />
                              ))}
                            </div>
                          </div>
                        );
                      })}

                      {ungrouped.length > 0 && (
                        <div className="space-y-1">
                          {folders.length > 0 && (
                            <div className="text-xs pb-1" style={{ color: "#4a5568" }}>Ungrouped</div>
                          )}
                          {ungrouped.map((project) => (
                            <ProjectRow
                              key={project.id}
                              project={project}
                              space={space}
                              folders={folders}
                              onRemove={() => handleRemoveProject(space.id, project.id)}
                              onMoveToFolder={(fn) => handleMoveToFolder(space.id, project.id, fn)}
                            />
                          ))}
                        </div>
                      )}

                      {space.projects.length === 0 && (
                        <div className="text-xs py-2 text-center" style={{ color: "#2e4a7a" }}>No repos yet</div>
                      )}

                      {isAdding ? (
                        <div className="rounded p-3 space-y-2" style={{ background: "var(--hover-bg)", border: "1px solid var(--surface)" }}>
                          <select
                            value={addProjectId}
                            onChange={(e) => setAddProjectId(e.target.value)}
                            style={INPUT_STYLE}
                          >
                            <option value="">Select repo...</option>
                            {getProjectsNotInSpace(space).map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={addFolderName}
                            onChange={(e) => setAddFolderName(e.target.value)}
                            placeholder={folders.length > 0 ? `Folder (${folders.join(", ")}) or new...` : "Folder name (optional)..."}
                            style={INPUT_STYLE}
                            list={`folders-${space.id}`}
                          />
                          <datalist id={`folders-${space.id}`}>
                            {folders.map((f) => <option key={f} value={f} />)}
                          </datalist>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleAddProject(space.id)}
                              disabled={!addProjectId}
                              className="flex-1 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                              style={{ background: "rgba(0,255,136,0.12)", color: "#00ff88", border: "1px solid rgba(0,255,136,0.25)" }}
                            >
                              Add Repo
                            </button>
                            <button
                              type="button"
                              onClick={() => { setAddingToSpace(null); setAddProjectId(""); setAddFolderName(""); }}
                              className="px-3 py-1.5 rounded text-xs"
                              style={{ background: "var(--btn-bg)", color: "var(--dim)", border: "1px solid var(--input-border)" }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setAddingToSpace(space); setAddProjectId(""); setAddFolderName(""); }}
                          className="w-full py-1.5 rounded text-xs transition-opacity hover:opacity-80"
                          style={{ background: "var(--hover-bg)", color: "#4a5568", border: "1px dashed var(--surface)" }}
                        >
                          + Add Repo
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const FOLDER_ICON = (
  <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const FILE_ICON = (
  <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

function TreeNode({
  node,
  depth,
  projectId,
  onMoved,
  dragOverPath,
  setDragOverPath,
}: {
  node: FileNode;
  depth: number;
  projectId: string;
  onMoved: () => void;
  dragOverPath: string | null;
  setDragOverPath: (p: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const isDir = node.type === "directory";

  return (
    <div>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("application/json", JSON.stringify({
            sourceProjectId: projectId,
            sourcePath: node.path,
          }));
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (isDir) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDragOverPath(node.path);
          }
        }}
        onDragLeave={() => {
          if (dragOverPath === node.path) setDragOverPath(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOverPath(null);
          if (!isDir) return;
          try {
            const payload = JSON.parse(e.dataTransfer.getData("application/json") || "{}");
            if (!payload.sourcePath || payload.sourcePath === node.path) return;
            fetch("/api/files/move", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                projectId: payload.sourceProjectId || projectId,
                sourcePath: payload.sourcePath,
                destinationDir: node.path,
              }),
            }).then((res) => res.json()).then((resp) => {
              if (resp?.success) onMoved();
            });
          } catch { /* ignore invalid drag data */ }
        }}
        className="flex items-center gap-1.5 px-1 py-0.5 rounded text-xs cursor-pointer transition-colors"
        style={{
          paddingLeft: `${depth * 14 + 4}px`,
          color: dragOverPath === node.path ? "#00d4ff" : "var(--dim)",
          background: dragOverPath === node.path ? "rgba(0,212,255,0.08)" : "transparent",
          outline: dragOverPath === node.path ? "1px dashed rgba(0,212,255,0.3)" : "none",
        }}
        onClick={() => isDir && setExpanded(!expanded)}
      >
        {isDir ? (
          <svg className="w-2.5 h-2.5 flex-shrink-0 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        ) : (
          <span className="w-2.5 flex-shrink-0" />
        )}
        <span style={{ color: isDir ? "var(--dim)" : "var(--dim)" }}>
          {isDir ? FOLDER_ICON : FILE_ICON}
        </span>
        <span className="truncate">{node.name}</span>
      </div>
      {isDir && expanded && node.children && node.children.map((child) => (
        <TreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          projectId={projectId}
          onMoved={onMoved}
          dragOverPath={dragOverPath}
          setDragOverPath={setDragOverPath}
        />
      ))}
    </div>
  );
}

function ProjectRow({
  project,
  space,
  folders,
  onRemove,
  onMoveToFolder,
}: {
  project: Project;
  space: Space;
  folders: string[];
  onRemove: () => void;
  onMoveToFolder: (folder: string | null) => void;
}) {
  const [showMove, setShowMove] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [tree, setTree] = useState<FileNode[] | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const loadTreeRef = useRef<(projectId: string) => void>(() => {});

  loadTreeRef.current = (pid: string) => {
    setLoadingTree(true);
    fetch(`/api/files/tree?projectId=${pid}`)
      .then((res) => res.json())
      .then((data) => {
        setTree(data.tree ?? []);
        setLoadingTree(false);
      })
      .catch(() => setLoadingTree(false));
  };

  useEffect(() => {
    if (expanded && tree === null) {
      loadTreeRef.current(project.id);
    }
  }, [expanded, tree, project.id]);

  const handleMoved = useCallback(() => {
    loadTreeRef.current(project.id);
  }, [project.id]);

  return (
    <div style={{ background: "var(--hover-bg)" }}>
      <div className="flex items-center justify-between px-2 py-1.5 gap-2 group">
        <div className="flex items-center gap-2 min-w-0">
          <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="#4a5568" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          <span className="text-xs truncate" style={{ color: "var(--text)" }}>{project.name}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {showMove ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
                placeholder="Folder or blank"
                list={`move-folders-${project.id}`}
                className="text-xs px-1.5 py-0.5 rounded w-24"
                style={{ background: "var(--surface)", border: "1px solid var(--input-border)", color: "var(--text)", outline: "none" }}
              />
              <datalist id={`move-folders-${project.id}`}>
                {folders.filter((f) => f !== project.folderName).map((f) => <option key={f} value={f} />)}
              </datalist>
              <button
                type="button"
                onClick={() => { onMoveToFolder(newFolder.trim() || null); setShowMove(false); }}
                className="text-xs px-1.5 py-0.5 rounded"
                style={{ background: "rgba(0,255,136,0.12)", color: "#00ff88", border: "1px solid rgba(0,255,136,0.25)" }}
              >✓</button>
              <button type="button" onClick={() => setShowMove(false)} className="text-xs" style={{ color: "#4a5568" }}>✕</button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => { setShowMove(true); setNewFolder(project.folderName || ""); }}
                className="text-xs px-1.5 py-0.5 rounded"
                style={{ color: "#4a5568" }}
                title="Move to folder"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="text-xs px-1.5 py-0.5 rounded"
                style={{ color: expanded ? space.color : "#4a5568" }}
                title={expanded ? "Hide files" : "Show files"}
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </button>
              <button
                type="button"
                onClick={onRemove}
                className="text-xs"
                style={{ color: "#4a5568" }}
                title="Remove"
              >×</button>
            </>
          )}
        </div>
      </div>
      {expanded && (
        <div className="px-2 pb-2" style={{ borderTop: "1px solid var(--surface)" }}>
          {loadingTree && tree === null ? (
            <div className="flex flex-col gap-1.5 py-2 px-1">
              {[70, 55, 80, 45, 65].map((w, i) => (
                <div key={i} className="skeleton h-2.5" style={{ width: `${w}%`, animationDelay: `${i * 0.06}s` }} />
              ))}
            </div>
          ) : tree && tree.length > 0 ? (
            <div className="py-1 max-h-64 overflow-y-auto">
              {tree.map((node) => (
                <TreeNode
                  key={node.path}
                  node={node}
                  depth={0}
                  projectId={project.id}
                  onMoved={handleMoved}
                  dragOverPath={dragOverPath}
                  setDragOverPath={setDragOverPath}
                />
              ))}
            </div>
          ) : (
            <div className="text-xs py-2 text-center" style={{ color: "#4a5568" }}>No files found</div>
          )}
        </div>
      )}
    </div>
  );
}
