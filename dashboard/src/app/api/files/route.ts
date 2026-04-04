import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "child_process";
import { safePath } from "@/lib/sanitize";
import { rm } from "fs/promises";
import { stat } from "fs/promises";

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const worktreeId = searchParams.get("worktreeId");
    const filePath = searchParams.get("path");

    if (!projectId || !filePath) {
      return NextResponse.json({ error: "projectId and path are required" }, { status: 400 });
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

    const fullPath = safePath(repoPath, filePath);

    try {
      const stats = await stat(fullPath);
      if (stats.isDirectory()) {
        execFileSync("git", ["rm", "-r", filePath], { cwd: repoPath, timeout: 10000 });
      } else {
        execFileSync("git", ["rm", filePath], { cwd: repoPath, timeout: 10000 });
      }
    } catch {
      try {
        await rm(fullPath, { recursive: true });
      } catch {
        return NextResponse.json({ error: "Failed to delete file" }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[/api/files DELETE] Error:", error);
    return NextResponse.json({ error: "Failed to delete file" }, { status: 500 });
  }
}
