import { NextRequest, NextResponse } from "next/server";
import { sessions, killSessionProcess } from "@/lib/terminal-sessions";

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  const session = sessions.get(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  killSessionProcess(session);
  sessions.delete(id);

  return NextResponse.json({ success: true });
}
