export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { respondToPermission, getTaskSession, getServer } from "@/lib/opencode-server";

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    taskId?: string;
    permissionId?: string;
    response?: "allow" | "deny";
    remember?: boolean;
  };

  if (!body.taskId || !body.permissionId || !body.response) {
    return NextResponse.json(
      { error: "taskId, permissionId, and response required" },
      { status: 400 }
    );
  }

  const mapping = getTaskSession(body.taskId);
  if (!mapping) {
    return NextResponse.json({ error: "No session for task" }, { status: 404 });
  }

  const server = getServer(mapping.serverId);
  if (!server || server.status !== "ready") {
    return NextResponse.json({ error: "Server not available" }, { status: 503 });
  }

  try {
    await respondToPermission(server, mapping.sessionId, body.permissionId, body.response, body.remember);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to respond to permission" },
      { status: 500 }
    );
  }
}
