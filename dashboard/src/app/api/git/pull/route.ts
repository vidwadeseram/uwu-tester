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
    const { worktreeId, projectId, rebase } = body;

    const repoPath = getRepoPath(worktreeId, projectId);
    if (!repoPath) {
      return NextResponse.json({ error: "Worktree or project not found" }, { status: 404 });
    }

    const args = rebase ? ["pull", "--rebase", "origin"] : ["pull", "origin"];

    try {
      execSync(`git ${args.join(" ")}`, {
        cwd: repoPath,
        timeout: 120000,
      });
      return NextResponse.json({ success: true });
    } catch (err) {
      const error = err as { message?: string };
      if (error.message?.includes("CONFLICT") || error.message?.includes("merge conflict")) {
        return NextResponse.json({ error: "Merge conflicts detected", conflicts: true }, { status: 409 });
      }
      throw err;
    }
  } catch (error) {
    console.error("[/api/git/pull POST] Error:", error);
    return NextResponse.json({ error: "Failed to pull" }, { status: 500 });
  }
}