import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  sessions,
  findAvailablePort,
  createTtydSession,
  startSessionCleanup,
  MAX_SESSIONS,
} from "@/lib/terminal-sessions";

const BASE_PORT = 7682;

startSessionCleanup();

export async function GET() {
  const sessionList = Array.from(sessions.values()).map((s) => ({
    id: s.id,
    port: s.port,
    createdAt: s.createdAt,
    lastActivity: s.lastActivity,
  }));
  return NextResponse.json({ sessions: sessionList });
}

export async function POST(request: NextRequest) {
  if (sessions.size >= MAX_SESSIONS) {
    return NextResponse.json(
      { error: `Maximum ${MAX_SESSIONS} concurrent sessions allowed` },
      { status: 429 }
    );
  }

  const id = randomUUID();
  const port = findAvailablePort(BASE_PORT);

  const session = createTtydSession(id, port);
  sessions.set(id, session);

  return NextResponse.json({
    id,
    port,
    wsUrl: `/terminal/${id}/`,
  });
}
