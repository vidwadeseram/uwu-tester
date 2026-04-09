export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { sendUserMessage } from "@/lib/opencode-server";

export async function POST(req: NextRequest) {
  const body = await req.json() as { taskId?: string; message?: string };
  if (!body.taskId || !body.message) {
    return NextResponse.json({ error: "taskId and message required" }, { status: 400 });
  }

  try {
    await sendUserMessage(body.taskId, body.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send message" },
      { status: 500 }
    );
  }
}
