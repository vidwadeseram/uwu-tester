export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { abortTask } from "@/lib/opencode-server";

export async function POST(req: NextRequest) {
  const body = await req.json() as { taskId?: string };
  if (!body.taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  try {
    await abortTask(body.taskId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to abort task" },
      { status: 500 }
    );
  }
}
