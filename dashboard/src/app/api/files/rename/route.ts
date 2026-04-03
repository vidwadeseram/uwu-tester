import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, worktreeId, oldPath, newPath } = body;

    if (!projectId || !oldPath || !newPath) {
      return NextResponse.json({ error: "projectId, oldPath, and newPath are required" }, { status: 400 });
    }

    let repoPath: string;

    if (worktreeId) {
      const { getDb, schema } = await import("@/lib/db");
      const { eq } = await import("drizzle-orm");
      const db = getDb();
      const worktree = await db.select().from(schema.worktrees).where(eq(schema.worktrees.id, worktreeId)).get();
      if (!worktree) {
        return NextResponse.json({ error: "Worktree not found" }, { status: 404 });
      }
      repoPath = worktree.path;
    } else {
      const { getDb, schema } = await import("@/lib/db");
      const { eq } = await import("drizzle-orm");
      const db = getDb();
      const project = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
      if (!project) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
      repoPath = project.path;
    }

    try {
      execSync(`git mv "${oldPath}" "${newPath}"`, {
        cwd: repoPath,
        timeout: 10000,
      });
      return NextResponse.json({ success: true });
    } catch {
      const { rename } = await import("fs/promises");
      try {
        await rename(`${repoPath}/${oldPath}`, `${repoPath}/${newPath}`);
        return NextResponse.json({ success: true });
      } catch {
        return NextResponse.json({ error: "Failed to rename file" }, { status: 500 });
      }
    }
  } catch (error) {
    console.error("[/api/files/rename POST] Error:", error);
    return NextResponse.json({ error: "Failed to rename file" }, { status: 500 });
  }
}