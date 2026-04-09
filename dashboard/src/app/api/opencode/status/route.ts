export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getTaskStatus } from "@/lib/opencode-server";

export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get("taskId");
  if (!taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  const status = await getTaskStatus(taskId);
  if (!status) {
    return NextResponse.json({ error: "No session for task" }, { status: 404 });
  }

  return NextResponse.json(status);
}
