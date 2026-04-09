import { NextRequest, NextResponse } from "next/server";
import { safePath } from "@/lib/sanitize";
import path from "path";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, worktreeId, dirPath } = body as {
      projectId?: string;
      worktreeId?: string;
      dirPath?: string;
    };

    if (!projectId || !dirPath) {
      return NextResponse.json(
        { error: "projectId and dirPath are required" },
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

    const fullDirPath = safePath(repoPath, dirPath);

    const { mkdir } = await import("fs/promises");
    try {
      await mkdir(fullDirPath, { recursive: true });
    } catch (err) {
      const fsErr = err as NodeJS.ErrnoException;
      if (fsErr.code === "EEXIST") {
        return NextResponse.json({ error: "Directory already exists" }, { status: 409 });
      }
      return NextResponse.json({ error: "Failed to create directory" }, { status: 500 });
    }

    return NextResponse.json({ success: true, dirPath });
  } catch (error) {
    console.error("[/api/files/mkdir POST] Error:", error);
    return NextResponse.json({ error: "Failed to create directory" }, { status: 500 });
  }
}
