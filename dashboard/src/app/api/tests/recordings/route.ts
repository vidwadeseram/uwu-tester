import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const RESULTS_DIR = path.join(process.cwd(), "..", "regression_tests", "results");

/**
 * GET /api/tests/recordings?file=slug/recordings/run_id/case_id/video.webm
 * Serves a recording video file.
 */
export async function GET(req: NextRequest) {
  const file = new URL(req.url).searchParams.get("file");

  // Validate: only allow paths within RESULTS_DIR, no traversal
  if (!file || file.includes("..") || !file.match(/^[a-zA-Z0-9_\-/]+\.(webm|mp4)$/)) {
    return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
  }

  const filePath = path.join(RESULTS_DIR, file);

  if (!filePath.startsWith(RESULTS_DIR)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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
