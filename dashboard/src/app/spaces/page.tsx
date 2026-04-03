"use client";

import { useEffect, useState, useCallback } from "react";

interface Project {
  id: string;
  name: string;
  path: string;
  branch?: string;
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

const COLORS = ["#00ff88", "#ff6b6b", "#4ecdc4", "#ffe66d", "#a855f7", "#3b82f6", "#f97316", "#ec4899"];

export default function SpacesPage() {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewSpace, setShowNewSpace] = useState(false);
  const [editingSpace, setEditingSpace] = useState<Space | null>(null);
  const [addingProjectTo, setAddingProjectTo] = useState<Space | null>(null);
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

  const handleAddProject = async (spaceId: string, projectId: string) => {
    try {
      const res = await fetch(`/api/spaces/${spaceId}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (res.ok) {
        setAddingProjectTo(null);
        loadSpaces();
      }
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

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900 text-white">
        Loading...
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-slate-900 text-slate-100">
      <div className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700">
        <h1 className="text-lg font-semibold">Spaces</h1>
        <button
          type="button"
          onClick={() => setShowNewSpace(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm"
        >
          + New Space
        </button>
      </div>

      {showNewSpace && (
        <div className="p-4 bg-slate-800 border-b border-slate-700">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <input
              type="text"
              value={newSpace.name}
              onChange={(e) => setNewSpace({ ...newSpace, name: e.target.value })}
              placeholder="Space name..."
              className="px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm"
            />
            <input
              type="text"
              value={newSpace.description}
              onChange={(e) => setNewSpace({ ...newSpace, description: e.target.value })}
              placeholder="Description (optional)..."
              className="px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm"
            />
          </div>
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-400">Color:</span>
              <div className="flex gap-1">
                {COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setNewSpace({ ...newSpace, color })}
                    className={`w-6 h-6 rounded-full ${newSpace.color === color ? "ring-2 ring-white" : ""}`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCreateSpace}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowNewSpace(false)}
              className="px-4 py-2 bg-slate-600 hover:bg-slate-500 rounded text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {spaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <p>No spaces yet</p>
            <p className="text-sm mt-1">Create a space to organize your projects</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {spaces.map((space) => (
              <div
                key={space.id}
                className="bg-slate-800 rounded-lg overflow-hidden"
                style={{ borderTop: `3px solid ${space.color}` }}
              >
                {editingSpace?.id === space.id ? (
                  <div className="p-4">
                    <input
                      type="text"
                      value={editingSpace.name}
                      onChange={(e) => setEditingSpace({ ...editingSpace, name: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm mb-2"
                    />
                    <input
                      type="text"
                      value={editingSpace.description || ""}
                      onChange={(e) => setEditingSpace({ ...editingSpace, description: e.target.value })}
                      placeholder="Description..."
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm mb-3"
                    />
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-sm text-slate-400">Color:</span>
                      <div className="flex gap-1">
                        {COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => setEditingSpace({ ...editingSpace, color })}
                            className={`w-5 h-5 rounded-full ${editingSpace.color === color ? "ring-2 ring-white" : ""}`}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleUpdateSpace}
                        className="px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded text-xs"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingSpace(null)}
                        className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 rounded text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="px-4 py-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-8 h-8 rounded flex items-center justify-center text-sm font-medium"
                          style={{ backgroundColor: space.color + "20", color: space.color }}
                        >
                          {space.name.charAt(0).toUpperCase()}
                        </span>
                        <div>
                          <h3 className="font-medium">{space.name}</h3>
                          {space.description && (
                            <p className="text-xs text-slate-400 mt-0.5">{space.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => setEditingSpace(space)}
                          className="px-2 py-1 text-xs text-slate-400 hover:text-white hover:bg-slate-700 rounded"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSpace(space.id)}
                          className="px-2 py-1 text-xs text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    <div className="px-4 pb-2">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-slate-400">
                          {space.projects.length} project{space.projects.length !== 1 ? "s" : ""}
                        </span>
                        <button
                          type="button"
                          onClick={() => setAddingProjectTo(space)}
                          className="text-xs text-blue-400 hover:text-blue-300"
                        >
                          + Add
                        </button>
                      </div>

                      {addingProjectTo?.id === space.id && (
                        <div className="mb-2 p-2 bg-slate-700 rounded">
                          <select
                            onChange={(e) => {
                              if (e.target.value) handleAddProject(space.id, e.target.value);
                            }}
                            className="w-full px-2 py-1.5 bg-slate-600 border border-slate-500 rounded text-sm"
                            defaultValue=""
                          >
                            <option value="">Select project...</option>
                            {getProjectsNotInSpace(space).map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => setAddingProjectTo(null)}
                            className="mt-1 text-xs text-slate-400 hover:text-white"
                          >
                            Cancel
                          </button>
                        </div>
                      )}

                      {space.projects.length > 0 ? (
                        <div className="space-y-1">
                          {space.projects.map((project) => (
                            <div
                              key={project.id}
                              className="flex items-center justify-between px-2 py-1.5 bg-slate-700/50 rounded text-sm"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-slate-400">📁</span>
                                <span className="truncate">{project.name}</span>
                                {project.branch && (
                                  <span className="text-xs text-slate-500 truncate">{project.branch}</span>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveProject(space.id, project.id)}
                                className="text-slate-500 hover:text-red-400 flex-shrink-0"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 italic">No projects</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
