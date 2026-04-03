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

interface CommitLog {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: string;
  message: string;
  body?: string;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const worktreeId = searchParams.get("worktreeId");
    const projectId = searchParams.get("projectId");
    const limit = parseInt(searchParams.get("limit") || "50");
    const skip = parseInt(searchParams.get("skip") || "0");

    const repoPath = getRepoPath(worktreeId || undefined, projectId || undefined);
    if (!repoPath) {
      return NextResponse.json({ error: "Worktree or project not found" }, { status: 404 });
    }

    const format = "%H|%h|%an|%ae|%aI|%s|%b";
    const output = execSync(`git log --format="${format}" -n ${limit} --skip ${skip}`, {
      encoding: "utf-8",
      cwd: repoPath,
      timeout: 10000,
    });

    const logs: CommitLog[] = [];
    for (const line of output.split("\n").filter(Boolean)) {
      const [hash, shortHash, author, email, date, ...messageParts] = line.split("|");
      const bodyIndex = messageParts.join("|").indexOf("\n");
      const message = bodyIndex >= 0 ? messageParts.join("|").slice(0, bodyIndex) : messageParts.join("|");
      const body = bodyIndex >= 0 ? messageParts.join("|").slice(bodyIndex + 1) : undefined;

      logs.push({
        hash,
        shortHash,
        author,
        email,
        date,
        message,
        body,
      });
    }

    return NextResponse.json({ logs });
  } catch (error) {
    console.error("[/api/git/log GET] Error:", error);
    return NextResponse.json({ error: "Failed to get commit log" }, { status: 500 });
  }
}