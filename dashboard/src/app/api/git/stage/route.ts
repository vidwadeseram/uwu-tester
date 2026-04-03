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
    const { worktreeId, projectId, files } = body;

    const repoPath = getRepoPath(worktreeId, projectId);
    if (!repoPath) {
      return NextResponse.json({ error: "Worktree or project not found" }, { status: 404 });
    }

    if (!files || !Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ error: "files array is required" }, { status: 400 });
    }

    for (const file of files) {
      execSync(`git add "${file}"`, {
        cwd: repoPath,
        timeout: 10000,
      });
    }

    return NextResponse.json({ success: true, staged: files });
  } catch (error) {
    console.error("[/api/git/stage POST] Error:", error);
    return NextResponse.json({ error: "Failed to stage files" }, { status: 500 });
  }
}