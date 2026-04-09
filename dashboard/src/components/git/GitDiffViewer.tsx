"use client";

import { useState } from "react";

interface DiffHunkHeader {
  type: "hunk-header";
  content: string;
}

interface DiffLine {
  type: "added" | "removed" | "context";
  content: string;
  newLineNum?: number;
  oldLineNum?: number;
}

interface DiffFileHeader {
  type: "file-header";
  oldFile: string;
  newFile: string;
}

type DiffEntry = DiffFileHeader | DiffHunkHeader | DiffLine;

interface ParsedFile {
  header: DiffFileHeader;
  entries: DiffEntry[];
  additions: number;
  deletions: number;
}

function parseUnifiedDiff(diffText: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  const lines = diffText.split("\n");
  let currentFile: ParsedFile | null = null;
  let oldLineNum = 0;
  let newLineNum = 0;

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (match) {
        currentFile = {
          header: { type: "file-header", oldFile: match[1], newFile: match[2] },
          entries: [],
          additions: 0,
          deletions: 0,
        };
        files.push(currentFile);
      }
      continue;
    }

    if (!currentFile) continue;

    if (line.startsWith("--- ") || line.startsWith("+++ ")) continue;

    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLineNum = parseInt(match[1]);
        newLineNum = parseInt(match[1]);
      }
      currentFile.entries.push({ type: "hunk-header", content: line });
      continue;
    }

    if (line.startsWith("+")) {
      currentFile.entries.push({ type: "added", content: line.slice(1), newLineNum });
      currentFile.additions++;
      newLineNum++;
    } else if (line.startsWith("-")) {
      currentFile.entries.push({ type: "removed", content: line.slice(1), oldLineNum });
      currentFile.deletions++;
      oldLineNum++;
    } else if (line.startsWith(" ")) {
      currentFile.entries.push({
        type: "context",
        content: line.slice(1),
        oldLineNum,
        newLineNum,
      });
      oldLineNum++;
      newLineNum++;
    }
  }

  return files;
}

function DiffFileBlock({ file, defaultExpanded }: { file: ParsedFile; defaultExpanded: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const visibleEntries = expanded
    ? file.entries
    : file.entries.filter((e) => e.type === "hunk-header" || e.type === "added" || e.type === "removed");

  return (
    <div className="rounded-lg overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
        style={{ background: expanded ? "var(--hover-bg)" : "transparent", borderBottom: expanded ? "1px solid var(--border)" : "none" }}
      >
        <span style={{ color: "var(--dim)", fontSize: "0.65rem", transition: "transform 0.15s", display: "inline-block", transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}>
          ▶
        </span>
        <span className="font-mono text-sm flex-1 truncate" style={{ color: "var(--text)" }}>
          {file.header.newFile}
        </span>
        {file.additions > 0 && (
          <span className="text-xs font-mono px-1.5 rounded" style={{ background: "rgba(0,255,136,0.1)", color: "var(--green)" }}>
            +{file.additions}
          </span>
        )}
        {file.deletions > 0 && (
          <span className="text-xs font-mono px-1.5 rounded" style={{ background: "rgba(255,68,68,0.1)", color: "var(--red)" }}>
            -{file.deletions}
          </span>
        )}
      </button>

      {expanded && (
        <div className="overflow-x-auto font-mono text-xs" style={{ lineHeight: "1.6" }}>
          {visibleEntries.map((entry, idx) => {
            if (entry.type === "hunk-header") {
              return (
                <div
                  key={`hunk-${idx}`}
                  className="px-4 py-1"
                  style={{ background: "rgba(0,212,255,0.06)", color: "var(--cyan)", fontSize: "0.7rem" }}
                >
                  {entry.content}
                </div>
              );
            }

            if (entry.type === "file-header") return null;

            const bgColor = entry.type === "added"
              ? "rgba(0,255,136,0.08)"
              : entry.type === "removed"
                ? "rgba(255,68,68,0.08)"
                : "transparent";
            const textColor = entry.type === "added"
              ? "var(--green)"
              : entry.type === "removed"
                ? "var(--red)"
                : "var(--dim)";
            const prefix = entry.type === "added" ? "+" : entry.type === "removed" ? "-" : " ";

            const lineNum = entry.type === "added"
              ? entry.newLineNum
              : entry.type === "removed"
                ? entry.oldLineNum
                : entry.oldLineNum;

            return (
              <div
                key={`line-${idx}`}
                className="flex"
                style={{ background: bgColor }}
              >
                <span
                  className="shrink-0 text-right px-2 select-none"
                  style={{ color: "var(--border)", width: "3.5rem", borderRight: "1px solid var(--border)" }}
                >
                  {lineNum ?? ""}
                </span>
                <span className="shrink-0 select-none px-1" style={{ color: textColor, width: "1.2rem" }}>
                  {prefix}
                </span>
                <span className="flex-1 px-2 whitespace-pre" style={{ color: textColor }}>
                  {entry.content || " "}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface GitDiffViewerProps {
  diff: string;
  defaultExpanded?: boolean;
  emptyMessage?: string;
}

export function GitDiffViewer({ diff, defaultExpanded = false, emptyMessage = "No changes" }: GitDiffViewerProps) {
  if (!diff || diff.trim() === "") {
    return (
      <div className="text-center py-6">
        <p className="text-sm" style={{ color: "var(--dim)" }}>{emptyMessage}</p>
      </div>
    );
  }

  const files = parseUnifiedDiff(diff);

  if (files.length === 0) {
    return (
      <div className="rounded-lg overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="p-4 overflow-x-auto font-mono text-xs whitespace-pre" style={{ color: "var(--dim)", lineHeight: "1.6" }}>
          {diff}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {files.map((file, idx) => (
        <DiffFileBlock
          key={`${file.header.newFile}-${idx}`}
          file={file}
          defaultExpanded={defaultExpanded || files.length === 1}
        />
      ))}
    </div>
  );
}
