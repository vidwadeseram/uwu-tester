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

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const iconStyle = { width: "14px", height: "14px", flexShrink: 0 };

  if (ext === "ts" || ext === "tsx") {
    return (
      <svg viewBox="0 0 24 24" fill="none" style={iconStyle}>
        <rect x="3" y="3" width="18" height="18" rx="2" fill="#3178c6" />
        <path d="M12 7v2M12 11v6M9 17h6" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        <text x="8" y="16" fontSize="8" fill="white" fontWeight="bold" fontFamily="monospace">TS</text>
      </svg>
    );
  }
  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") {
    return (
      <svg viewBox="0 0 24 24" fill="none" style={iconStyle}>
        <rect x="3" y="3" width="18" height="18" rx="2" fill="#f7df1e" />
        <text x="7" y="17" fontSize="10" fill="#323330" fontWeight="bold" fontFamily="monospace">JS</text>
      </svg>
    );
  }
  if (ext === "json") {
    return (
      <svg viewBox="0 0 24 24" fill="none" style={iconStyle}>
        <rect x="3" y="3" width="18" height="18" rx="2" fill="#cbcb41" />
        <text x="5" y="16" fontSize="9" fill="#323330" fontWeight="bold" fontFamily="monospace">{`{}`}</text>
      </svg>
    );
  }
  if (ext === "md" || ext === "mdx") {
    return (
      <svg viewBox="0 0 24 24" fill="none" style={iconStyle}>
        <rect x="3" y="3" width="18" height="18" rx="2" fill="#083fa1" />
        <text x="5" y="15" fontSize="7" fill="white" fontWeight="bold" fontFamily="monospace">MD</text>
      </svg>
    );
  }
  if (ext === "css" || ext === "scss" || ext === "sass" || ext === "less") {
    return (
      <svg viewBox="0 0 24 24" fill="none" style={iconStyle}>
        <rect x="3" y="3" width="18" height="18" rx="2" fill="#264de4" />
        <text x="5" y="15" fontSize="8" fill="white" fontWeight="bold" fontFamily="monospace">CSS</text>
      </svg>
    );
  }
  if (ext === "html" || ext === "htm") {
    return (
      <svg viewBox="0 0 24 24" fill="none" style={iconStyle}>
        <rect x="3" y="3" width="18" height="18" rx="2" fill="#e44d26" />
        <text x="4" y="15" fontSize="7" fill="white" fontWeight="bold" fontFamily="monospace">HTML</text>
      </svg>
    );
  }
  if (ext === "py") {
    return (
      <svg viewBox="0 0 24 24" fill="none" style={iconStyle}>
        <rect x="3" y="3" width="18" height="18" rx="2" fill="#3776ab" />
        <text x="6" y="15" fontSize="8" fill="#ffd43b" fontWeight="bold" fontFamily="monospace">PY</text>
      </svg>
    );
  }
  if (ext === "go") {
    return (
      <svg viewBox="0 0 24 24" fill="none" style={iconStyle}>
        <rect x="3" y="3" width="18" height="18" rx="2" fill="#00add8" />
        <text x="6" y="15" fontSize="8" fill="white" fontWeight="bold" fontFamily="monospace">GO</text>
      </svg>
    );
  }
  if (ext === "rs") {
    return (
      <svg viewBox="0 0 24 24" fill="none" style={iconStyle}>
        <rect x="3" y="3" width="18" height="18" rx="2" fill="#dea584" />
        <text x="5" y="15" fontSize="8" fill="#28314b" fontWeight="bold" fontFamily="monospace">RS</text>
      </svg>
    );
  }
  if (ext === "sh" || ext === "bash" || ext === "zsh") {
    return (
      <svg viewBox="0 0 24 24" fill="none" style={iconStyle}>
        <rect x="3" y="3" width="18" height="18" rx="2" fill="#89e051" />
        <text x="7" y="13" fontSize="6" fill="#232323" fontFamily="monospace">&gt;_</text>
      </svg>
    );
  }
  if (ext === "yaml" || ext === "yml") {
    return (
      <svg viewBox="0 0 24 24" fill="none" style={iconStyle}>
        <rect x="3" y="3" width="18" height="18" rx="2" fill="#cb171e" />
        <text x="5" y="15" fontSize="7" fill="white" fontWeight="bold" fontFamily="monospace">YML</text>
      </svg>
    );
  }
  if (ext === "toml") {
    return (
      <svg viewBox="0 0 24 24" fill="none" style={iconStyle}>
        <rect x="3" y="3" width="18" height="18" rx="2" fill="#9c4121" />
        <text x="4" y="15" fontSize="7" fill="white" fontWeight="bold" fontFamily="monospace">TOML</text>
      </svg>
    );
  }
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"].includes(ext)) {
    return (
      <svg viewBox="0 0 24 24" fill="none" style={iconStyle}>
        <rect x="3" y="3" width="18" height="18" rx="2" fill="#4bae50" />
        <rect x="6" y="7" width="5" height="5" rx="1" fill="white" opacity="0.6" />
        <rect x="13" y="10" width="5" height="7" rx="1" fill="white" opacity="0.4" />
      </svg>
    );
  }
  if (ext === "gitignore" || ext === "dockerignore" || ext === "eslintignore") {
    return (
      <svg viewBox="0 0 24 24" fill="none" style={iconStyle}>
        <rect x="3" y="3" width="18" height="18" rx="2" fill="#f14e32" />
        <circle cx="12" cy="12" r="5" stroke="white" strokeWidth="1.5" fill="none" />
        <line x1="9" y1="9" x2="15" y2="15" stroke="white" strokeWidth="1.5" />
      </svg>
    );
  }
  if (name === "package.json" || name === "package-lock.json") {
    return (
      <svg viewBox="0 0 24 24" fill="none" style={iconStyle}>
        <rect x="3" y="3" width="18" height="18" rx="2" fill="#cb3837" />
        <text x="6" y="15" fontSize="7" fill="white" fontWeight="bold" fontFamily="monospace">PKG</text>
      </svg>
    );
  }
  if (name === "README.md" || name === "readme.md") {
    return (
      <svg viewBox="0 0 24 24" fill="none" style={iconStyle}>
        <rect x="3" y="3" width="18" height="18" rx="2" fill="#083fa1" />
        <text x="3" y="15" fontSize="6" fill="white" fontWeight="bold" fontFamily="monospace">README</text>
      </svg>
    );
  }
  if (name.startsWith(".") && !name.includes(".")) {
    return (
      <svg viewBox="0 0 24 24" fill="none" style={iconStyle}>
        <rect x="3" y="3" width="18" height="18" rx="2" fill="#6b7280" />
        <text x="7" y="15" fontSize="8" fill="white" fontWeight="bold" fontFamily="monospace">HC</text>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" style={iconStyle}>
      <path d="M7 3H17L20 6V20H4V3H7Z" fill="#6b7280" />
      <path d="M7 3V6H4L7 3Z" fill="#9ca3af" />
      <path d="M17 3V6H20L17 3Z" fill="#4b5563" />
    </svg>
  );
}

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
          className="flex items-center gap-1.5 w-full px-2 py-1 hover:bg-white/5 text-left text-sm"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          <svg viewBox="0 0 24 24" fill="none" style={{ width: "14px", height: "14px", flexShrink: 0 }}>
            <path
              d={expanded ? "M3 7V17C3 18.1 3.9 19 5 19H19C20.1 19 21 18.1 21 17V9C21 7.9 20.1 7 19 7H12L10 5H5C3.9 5 3 5.9 3 7Z" : "M3 7V17C3 18.1 3.9 19 5 19H19C20.1 19 21 18.1 21 17V9C21 7.9 20.1 7 19 7H12L10 5H5C3.9 5 3 5.9 3 7Z"}
              fill={expanded ? "#00d4ff" : "#64748b"}
            />
          </svg>
          <span style={{ color: expanded ? "#e2e8f0" : "#94a3b8" }}>{node.name}</span>
          {node.gitStatus && (
            <span className={`ml-auto w-4 h-4 rounded text-xs flex items-center justify-center text-white ${gitStatusColors[node.gitStatus]}`}>
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
      className={`flex items-center gap-1.5 w-full px-2 py-1 text-left text-sm ${isSelected ? "bg-cyan-500/10" : "hover:bg-white/5"}`}
      style={{ paddingLeft: `${depth * 16 + 8}px`, color: isSelected ? "#e2e8f0" : "#94a3b8" }}
    >
      {getFileIcon(node.name)}
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
    <div className="h-full overflow-auto rounded" style={{ background: "var(--card)" }}>
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