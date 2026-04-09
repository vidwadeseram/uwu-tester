export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getTaskDiff } from "@/lib/opencode-server";

export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get("taskId");
  if (!taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  const diff = await getTaskDiff(taskId);
  return NextResponse.json({ diff });
}
