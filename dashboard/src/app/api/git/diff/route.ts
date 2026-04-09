import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "child_process";
import { safePath } from "@/lib/sanitize";

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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const worktreeId = searchParams.get("worktreeId");
    const filePath = searchParams.get("path");
    const staged = searchParams.get("staged") === "true";
    const commit = searchParams.get("commit");

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const repoPath = getRepoPath(worktreeId || undefined, projectId || undefined);
    if (!repoPath) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    try {
      let args: string[];

      if (commit) {
        if (filePath) {
          const resolvedPath = safePath(repoPath, filePath);
          args = ["show", "--format=", "--patch", commit, "--", resolvedPath];
        } else {
          args = ["show", "--format=", "--stat", "--patch", commit];
        }
      } else if (filePath) {
        const resolvedPath = safePath(repoPath, filePath);
        if (staged) {
          args = ["diff", "--cached", "--", resolvedPath];
        } else {
          args = ["diff", "--", resolvedPath];
        }
      } else {
        if (staged) {
          args = ["diff", "--cached", "--stat"];
        } else {
          args = ["diff", "--stat"];
        }
      }

      const diff = execFileSync("git", args, {
        encoding: "utf-8",
        cwd: repoPath,
        timeout: 15000,
        maxBuffer: 5 * 1024 * 1024,
      });

      return NextResponse.json({ diff: diff || "" });
    } catch {
      return NextResponse.json({ diff: "" });
    }
  } catch (error) {
    console.error("[/api/git/diff GET] Error:", error);
    return NextResponse.json({ error: "Failed to get diff" }, { status: 500 });
  }
}
