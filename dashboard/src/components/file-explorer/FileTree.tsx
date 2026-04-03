"use client";

import { useState } from "react";

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  gitStatus?: "modified" | "added" | "deleted" | "untracked" | "renamed" | "copied" | "unmerged" | "unknown";
  children?: FileNode[];
}

interface FileTreeProps {
  nodes: FileNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  filter?: string;
}

const gitStatusColors: Record<string, string> = {
  modified: "bg-yellow-500",
  added: "bg-green-500",
  deleted: "bg-red-500",
  untracked: "bg-gray-500",
  renamed: "bg-blue-500",
  copied: "bg-purple-500",
  unmerged: "bg-orange-500",
  unknown: "bg-gray-400",
};

const gitStatusLabels: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  untracked: "?",
  renamed: "R",
  copied: "C",
  unmerged: "U",
  unknown: "!",
};

function FileNodeComponent({
  node,
  selectedPath,
  onSelect,
  filter,
  depth = 0,
}: {
  node: FileNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  filter?: string;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);

  const matchesFilter = !filter || node.name.toLowerCase().includes(filter.toLowerCase());
  const hasMatchingChildren = node.children?.some(
    (child) =>
      !filter ||
      child.name.toLowerCase().includes(filter.toLowerCase()) ||
      child.children?.some((grandChild) => grandChild.name.toLowerCase().includes(filter.toLowerCase()))
  );

  if (filter && !matchesFilter && !hasMatchingChildren) {
    return null;
  }

  if (node.type === "directory") {
    return (
      <div>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 w-full px-2 py-1 hover:bg-slate-700 text-left text-sm"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          <span className="text-slate-400">{expanded ? "▼" : "▶"}</span>
          <span className="text-slate-300">{node.name}</span>
          {node.gitStatus && (
            <span className={`w-4 h-4 rounded text-xs flex items-center justify-center text-white ${gitStatusColors[node.gitStatus]}`}>
              {gitStatusLabels[node.gitStatus]}
            </span>
          )}
        </button>
        {expanded && node.children && (
          <div>
            {node.children.map((child) => (
              <FileNodeComponent
                key={child.path}
                node={child}
                selectedPath={selectedPath}
                onSelect={onSelect}
                filter={filter}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isSelected = selectedPath === node.path;

  return (
    <button
      type="button"
      onClick={() => onSelect(node.path)}
      className={`flex items-center gap-1 w-full px-2 py-1 text-left text-sm ${
        isSelected ? "bg-slate-700 text-white" : "hover:bg-slate-700 text-slate-300"
      }`}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      <span className="text-slate-500">
        {node.name.endsWith(".ts") || node.name.endsWith(".tsx")
          ? "📄"
          : node.name.endsWith(".json")
          ? "📋"
          : node.name.endsWith(".md")
          ? "📝"
          : node.name.endsWith(".css")
          ? "🎨"
          : node.name.endsWith(".html")
          ? "🌐"
          : "📄"}
      </span>
      <span className="truncate">{node.name}</span>
      {node.gitStatus && (
        <span className={`ml-auto w-4 h-4 rounded text-xs flex items-center justify-center text-white ${gitStatusColors[node.gitStatus]}`}>
          {gitStatusLabels[node.gitStatus]}
        </span>
      )}
    </button>
  );
}

export function FileTree({ nodes, selectedPath, onSelect, filter }: FileTreeProps) {
  return (
    <div className="h-full overflow-auto bg-slate-800 text-slate-200 rounded">
      {nodes.map((node) => (
        <FileNodeComponent
          key={node.path}
          node={node}
          selectedPath={selectedPath}
          onSelect={onSelect}
          filter={filter}
        />
      ))}
    </div>
  );
}