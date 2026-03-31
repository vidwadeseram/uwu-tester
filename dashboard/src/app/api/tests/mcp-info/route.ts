export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import path from "path";

/** GET /api/tests/mcp-info — returns paths needed to configure the MCP server */
export async function GET() {
  const regressionDir = path.resolve(process.cwd(), "..", "regression_tests");
  return NextResponse.json({
    regression_dir: regressionDir,
    mcp_server: path.join(regressionDir, "mcp_server.py"),
  });
}
