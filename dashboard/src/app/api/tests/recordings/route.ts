import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getReadableProjectPaths } from "@/app/lib/tests-paths";

const RESULTS_DIR = path.join(process.cwd(), "..", "regression_tests", "results");

/**
 * When the exact recording file (e.g. video.webm) doesn't exist but the
 * directory contains other .webm/.mp4 files (hash-named Playwright recordings),
 * pick the largest non-empty file in that directory.
 */
function findBestRecordingInDir(dir: string): string | null {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  const validExts = [".webm", ".mp4"];
  const candidates = fs.readdirSync(dir)
    .filter((f) => validExts.includes(path.extname(f).toLowerCase()))
    .map((f) => {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      return { path: full, size: stat.size };
    })
    .filter((c) => c.size > 0)
    .sort((a, b) => b.size - a.size);
  return candidates.length > 0 ? candidates[0].path : null;
}

function resolveRecordingPath(file: string): string | null {
  const project = file.split("/")[0] ?? "";
  const roots: string[] = [];

  if (/^[a-zA-Z0-9_-]+$/.test(project)) {
    roots.push(getReadableProjectPaths(project).resultsDir);
  }
  roots.push(RESULTS_DIR);

  for (const root of roots) {
    const exact = path.join(root, file);
    if (fs.existsSync(exact)) return exact;
  }

  // Exact file not found — try scanning the parent directory for recordings
  for (const root of roots) {
    const dir = path.dirname(path.join(root, file));
    const best = findBestRecordingInDir(dir);
    if (best) return best;
  }

  return null;
}

/**
 * GET /api/tests/recordings?file=slug/recordings/run_id/case_id/video.webm
 * Serves a recording video file.
 */
export async function GET(req: NextRequest) {
  const rawFile = new URL(req.url).searchParams.get("file");
  const file = rawFile?.startsWith("results/") ? rawFile.slice("results/".length) : rawFile;

  // Validate: only allow paths within RESULTS_DIR, no traversal
  if (!file || file.includes("..") || !file.match(/^[a-zA-Z0-9_\-/]+\.(webm|mp4)$/)) {
    return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
  }

  const filePath = resolveRecordingPath(file);
  if (!filePath) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const project = file.split("/")[0] ?? "";
  const projectRoot = /^[a-zA-Z0-9_-]+$/.test(project) ? getReadableProjectPaths(project).resultsDir : RESULTS_DIR;
  const allowedRoots = [RESULTS_DIR, projectRoot]
    .map((root) => path.resolve(root));
  const resolvedFilePath = path.resolve(filePath);
  if (!allowedRoots.some((root) => resolvedFilePath.startsWith(root + path.sep) || resolvedFilePath === root)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = ext === ".mp4" ? "video/mp4" : "video/webm";

  const stream = fs.createReadStream(filePath);
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(stat.size),
      "Content-Disposition": `inline; filename="${path.basename(filePath)}"`,
    },
  });
}
