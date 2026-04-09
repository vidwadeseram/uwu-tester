export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  getAllServers,
  getAllTaskSessions,
} from "@/lib/opencode-server";

export async function GET() {
  return NextResponse.json({
    servers: getAllServers().map((s) => ({
      id: s.id,
      workspace: s.workspace,
      port: s.port,
      hostname: s.hostname,
      pid: s.pid,
      startedAt: s.startedAt,
      status: s.status,
    })),
    taskSessions: getAllTaskSessions(),
  });
}
