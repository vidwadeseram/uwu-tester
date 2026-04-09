import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "child_process";
import { safePath } from "@/lib/sanitize";
import path from "path";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, worktreeId, sourcePath, destinationDir } = body as {
      projectId?: string;
      worktreeId?: string;
      sourcePath?: string;
      destinationDir?: string;
    };

    if (!projectId || !sourcePath || destinationDir === undefined) {
      return NextResponse.json(
        { error: "projectId, sourcePath, and destinationDir are required" },
        { status: 400 }
      );
    }

    let repoPath: string;

    if (worktreeId) {
      const { getDb, schema } = await import("@/lib/db");
      const { eq } = await import("drizzle-orm");
      const db = getDb();
      const worktree = await db
        .select()
        .from(schema.worktrees)
        .where(eq(schema.worktrees.id, worktreeId))
        .get();
      if (!worktree) {
        return NextResponse.json({ error: "Worktree not found" }, { status: 404 });
      }
      repoPath = worktree.path;
    } else {
      const { getDb, schema } = await import("@/lib/db");
      const { eq } = await import("drizzle-orm");
      const db = getDb();
      const project = await db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId))
        .get();
      if (!project) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
      repoPath = project.path;
    }

    const fullSourcePath = safePath(repoPath, sourcePath);
    const fileName = path.basename(sourcePath);
    const newPath = destinationDir ? `${destinationDir}/${fileName}` : fileName;
    const fullDestPath = safePath(repoPath, newPath);

    if (fullSourcePath === fullDestPath) {
      return NextResponse.json({ error: "Source and destination are the same" }, { status: 400 });
    }

    try {
      execFileSync("git", ["mv", sourcePath, newPath], {
        cwd: repoPath,
        timeout: 10000,
      });
    } catch {
      const { rename, mkdir } = await import("fs/promises");
      try {
        const destDir = path.dirname(fullDestPath);
        await mkdir(destDir, { recursive: true });
        await rename(fullSourcePath, fullDestPath);
      } catch {
        return NextResponse.json({ error: "Failed to move file" }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, newPath });
  } catch (error) {
    console.error("[/api/files/move POST] Error:", error);
    return NextResponse.json({ error: "Failed to move file" }, { status: 500 });
  }
}
