import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const worktreeId = searchParams.get("worktreeId");
    const filePath = searchParams.get("path");
    const staged = searchParams.get("staged") === "true";

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

    try {
      const diffArgs = staged
        ? ["diff", "--cached", "--", filePath]
        : ["diff", "--", filePath];

      const diff = execSync(`git ${diffArgs.join(" ")}`, {
        encoding: "utf-8",
        cwd: repoPath,
        timeout: 10000,
      });

      return NextResponse.json({ diff: diff || "", staged });
    } catch {
      return NextResponse.json({ diff: "", staged });
    }
  } catch (error) {
    console.error("[/api/files/diff GET] Error:", error);
    return NextResponse.json({ error: "Failed to get diff" }, { status: 500 });
  }
}