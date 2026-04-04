import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { getGitEnv } from "@/lib/git-credentials";

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
    const { worktreeId, projectId, setUpstream } = body;

    const repoPath = getRepoPath(worktreeId, projectId);
    if (!repoPath) {
      return NextResponse.json({ error: "Worktree or project not found" }, { status: 404 });
    }

    const env = getGitEnv();
    const args = setUpstream ? ["push", "-u", "origin", "HEAD"] : ["push"];
    const tagsArg = ["push", "--tags"];

    try {
      execSync(`git ${args.join(" ")}`, {
        cwd: repoPath,
        timeout: 60000,
        env,
      });
    } catch {
      try {
        execSync(`git ${tagsArg.join(" ")}`, {
          cwd: repoPath,
          timeout: 60000,
          env,
        });
      } catch {
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[/api/git/push POST] Error:", error);
    return NextResponse.json({ error: "Failed to push" }, { status: 500 });
  }
}