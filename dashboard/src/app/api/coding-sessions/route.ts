import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

interface CodingSessionInput {
  projectId: string;
  worktreeId?: string;
  tool: "opencode" | "claude" | "codex";
  task: string;
}

async function runToolViaServer(
  task: string,
  workingDir: string,
): Promise<{ serverId: string; sessionId: string }> {
  const { runTaskViaServer } = await import("@/lib/opencode-server");
  return runTaskViaServer({
    taskId: randomUUID(),
    title: task.slice(0, 60),
    description: task,
    workspace: workingDir,
    type: "coding",
    preferredTool: "opencode",
  });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const status = searchParams.get("status");

    const db = getDb();
    const sessions = projectId
      ? await db.select().from(schema.codingSessions).where(eq(schema.codingSessions.projectId, projectId))
      : status
        ? await db.select().from(schema.codingSessions).where(eq(schema.codingSessions.status, status))
        : await db.select().from(schema.codingSessions);

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("[/api/coding-sessions GET] Error:", error);
    return NextResponse.json({ error: "Failed to fetch coding sessions" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, worktreeId, tool, task } = body as CodingSessionInput;

    if (!projectId || !tool || !task) {
      return NextResponse.json(
        { error: "projectId, tool, and task are required" },
        { status: 400 }
      );
    }

    const db = getDb();
    const project = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    let workingDir = project.path;
    if (worktreeId) {
      const worktree = await db.select().from(schema.worktrees).where(eq(schema.worktrees.id, worktreeId)).get();
      if (worktree) {
        workingDir = worktree.path;
      }
    }

    const id = randomUUID();
    const startedAt = new Date();

    await db.insert(schema.codingSessions).values({
      id,
      projectId,
      worktreeId: worktreeId || null,
      tool,
      status: "running",
      task,
      startedAt,
    });

    try {
      const result = await runToolViaServer(task, workingDir);

      await db
        .update(schema.codingSessions)
        .set({
          status: "completed",
          result: `Task spawned via OpenCode Server. Session: ${result.sessionId}`,
          completedAt: new Date(),
          durationSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
        })
        .where(eq(schema.codingSessions.id, id));
    } catch (err) {
      await db
        .update(schema.codingSessions)
        .set({
          status: "failed",
          result: err instanceof Error ? err.message : String(err),
          completedAt: new Date(),
          durationSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
        })
        .where(eq(schema.codingSessions.id, id));
    }

    const session = await db.select().from(schema.codingSessions).where(eq(schema.codingSessions.id, id)).get();

    return NextResponse.json({ success: true, session });
  } catch (error) {
    console.error("[/api/coding-sessions POST] Error:", error);
    return NextResponse.json({ error: "Failed to run coding session" }, { status: 500 });
  }
}
