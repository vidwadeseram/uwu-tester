import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";

function getRepoPath(worktreeId?: string, projectId?: string): string | null {
  if (worktreeId) {
    const { getDb, schema } = require("@/lib/db");
    const { eq } = require("drizzle-orm");
    const db = getDb();
    const worktree = db.select().from(schema.worktrees).where(eq(schema.worktrees.id, worktreeId)).get();
    return worktree?.path || null;
  }
  if (projectId) {
    const { getDb, schema } = require("@/lib/db");
    const { eq } = require("drizzle-orm");
    const db = getDb();
    const project = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
    return project?.path || null;
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { worktreeId, projectId, message, description } = body;

    const repoPath = getRepoPath(worktreeId, projectId);
    if (!repoPath) {
      return NextResponse.json({ error: "Worktree or project not found" }, { status: 404 });
    }

    if (!message || message.trim() === "") {
      return NextResponse.json({ error: "Commit message is required" }, { status: 400 });
    }

    const fullMessage = description ? `${message}\n\n${description}` : message;

    try {
      const output = execSync(`git commit -m "${fullMessage.replace(/"/g, '\\"')}"`, {
        encoding: "utf-8",
        cwd: repoPath,
        timeout: 30000,
      });

      const commitHash = execSync("git rev-parse HEAD", {
        encoding: "utf-8",
        cwd: repoPath,
        timeout: 5000,
      }).trim();

      return NextResponse.json({ success: true, hash: commitHash, message: fullMessage });
    } catch (err) {
      const error = err as { message?: string };
      if (error.message?.includes("nothing to commit")) {
        return NextResponse.json({ error: "Nothing to commit" }, { status: 400 });
      }
      throw err;
    }
  } catch (error) {
    console.error("[/api/git/commit POST] Error:", error);
    return NextResponse.json({ error: "Failed to commit" }, { status: 500 });
  }
}