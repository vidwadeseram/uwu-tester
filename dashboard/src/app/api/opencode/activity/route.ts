export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getActivityLog, clearActivityLog } from "@/lib/opencode-server";

export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get("taskId");
  if (!taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  const activity = getActivityLog(taskId);
  return NextResponse.json({ activity });
}

export async function DELETE(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get("taskId");
  if (!taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  clearActivityLog(taskId);
  return NextResponse.json({ ok: true });
}
