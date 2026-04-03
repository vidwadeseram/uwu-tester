"use client";

interface DiffViewerProps {
  oldContent: string;
  newContent: string;
  mode: "inline" | "side-by-side";
}

export function DiffViewer({ oldContent, newContent, mode }: DiffViewerProps) {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  const diffLines: Array<{ type: "same" | "added" | "removed"; content: string; newLineNum?: number; oldLineNum?: number }> = [];

  let i = 0;
  let j = 0;
  let oldLineNum = 1;
  let newLineNum = 1;

  while (i < oldLines.length || j < newLines.length) {
    if (i >= oldLines.length) {
      diffLines.push({ type: "added", content: newLines[j], newLineNum: newLineNum });
      j++;
      newLineNum++;
    } else if (j >= newLines.length) {
      diffLines.push({ type: "removed", content: oldLines[i], oldLineNum: oldLineNum });
      i++;
      oldLineNum++;
    } else if (oldLines[i] === newLines[j]) {
      diffLines.push({ type: "same", content: oldLines[i], oldLineNum, newLineNum });
      i++;
      j++;
      oldLineNum++;
      newLineNum++;
    } else if (i + 1 < oldLines.length && oldLines[i + 1] === newLines[j]) {
      diffLines.push({ type: "removed", content: oldLines[i], oldLineNum: oldLineNum });
      i++;
      oldLineNum++;
    } else if (j + 1 < newLines.length && oldLines[i] === newLines[j + 1]) {
      diffLines.push({ type: "added", content: newLines[j], newLineNum: newLineNum });
      j++;
      newLineNum++;
    } else {
      diffLines.push({ type: "removed", content: oldLines[i], oldLineNum: oldLineNum });
      diffLines.push({ type: "added", content: newLines[j], newLineNum: newLineNum });
      i++;
      j++;
      oldLineNum++;
      newLineNum++;
    }
  }

  if (mode === "inline") {
    return (
      <div className="h-full overflow-auto bg-slate-900 text-slate-200 font-mono text-sm">
        <div className="px-4 py-2 bg-slate-800 border-b border-slate-700">
          <span className="text-slate-400">Inline Diff</span>
        </div>
        <div className="p-2">
          {diffLines.map((line, idx) => (
            <div
              key={idx}
              className={`px-2 py-0.5 ${
                line.type === "added"
                  ? "bg-green-900/50 text-green-300"
                  : line.type === "removed"
                  ? "bg-red-900/50 text-red-300"
                  : "text-slate-400"
              }`}
            >
              <span className="inline-block w-12 text-slate-500 select-none">
                {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
              </span>
              {line.content || " "}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const oldDiffLines = diffLines.filter((l) => l.type !== "added");
  const newDiffLines = diffLines.filter((l) => l.type !== "removed");

  return (
    <div className="h-full overflow-auto bg-slate-900 text-slate-200 font-mono text-sm">
      <div className="px-4 py-2 bg-slate-800 border-b border-slate-700">
        <span className="text-slate-400">Side-by-Side Diff</span>
      </div>
      <div className="flex">
        <div className="flex-1 border-r border-slate-700">
          <div className="px-2 py-1 bg-slate-800 border-b border-slate-700 text-slate-400 text-xs">
            Original
          </div>
          <div className="p-1">
            {oldDiffLines.map((line, idx) => (
              <div
                key={idx}
                className={`px-2 py-0.5 ${
                  line.type === "removed" ? "bg-red-900/50 text-red-300" : "text-slate-400"
                }`}
              >
                <span className="inline-block w-8 text-slate-500 select-none text-right mr-2">
                  {line.oldLineNum}
                </span>
                {line.content || " "}
              </div>
            ))}
          </div>
        </div>
        <div className="flex-1">
          <div className="px-2 py-1 bg-slate-800 border-b border-slate-700 text-slate-400 text-xs">
            Modified
          </div>
          <div className="p-1">
            {newDiffLines.map((line, idx) => (
              <div
                key={idx}
                className={`px-2 py-0.5 ${
                  line.type === "added" ? "bg-green-900/50 text-green-300" : "text-slate-400"
                }`}
              >
                <span className="inline-block w-8 text-slate-500 select-none text-right mr-2">
                  {line.newLineNum}
                </span>
                {line.content || " "}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}