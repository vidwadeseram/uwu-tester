import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";

interface GitFile {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "copied" | "untracked" | "unmerged" | "unknown";
  staged: boolean;
}

interface GitStatus {
  current: string | null;
  tracking: string | null;
  ahead: number;
  behind: number;
  files: GitFile[];
}

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

function parseStatusLine(line: string): GitFile | null {
  if (line.length < 3) return null;

  const index = line[0];
  const worktree = line[1];
  const path = line.slice(3);

  let status: GitFile["status"] = "unknown";
  const statusMap: Record<string, GitFile["status"]> = {
    "M": "modified",
    "A": "added",
    "D": "deleted",
    "R": "renamed",
    "C": "copied",
    "?": "untracked",
    "U": "unmerged",
  };

  status = statusMap[index] || "unknown";
  if (status === "unknown" && worktree !== " ") {
    status = statusMap[worktree] || "unknown";
  }

  return {
    path,
    status,
    staged: index !== " " && index !== "?",
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const worktreeId = searchParams.get("worktreeId");
    const projectId = searchParams.get("projectId");

    const repoPath = getRepoPath(worktreeId || undefined, projectId || undefined);
    if (!repoPath) {
      return NextResponse.json({ error: "Worktree or project not found" }, { status: 404 });
    }

    const statusOutput = execSync("git status --porcelain", {
      encoding: "utf-8",
      cwd: repoPath,
      timeout: 10000,
    });

    const files: GitFile[] = [];
    for (const line of statusOutput.split("\n").filter(Boolean)) {
      const file = parseStatusLine(line);
      if (file) files.push(file);
    }

    let current: string | null = null;
    let tracking: string | null = null;
    let ahead = 0;
    let behind = 0;

    try {
      const branchOutput = execSync("git rev-parse --abbrev-ref HEAD", {
        encoding: "utf-8",
        cwd: repoPath,
        timeout: 5000,
      }).trim();
      current = branchOutput || null;

      const remoteOutput = execSync("git svn info 2>/dev/null || git rev-parse --abbrev-ref @{upstream} 2>/dev/null || echo ''", {
        encoding: "utf-8",
        cwd: repoPath,
        timeout: 5000,
      }).trim();
      tracking = remoteOutput || null;

      const aheadBehind = execSync("git rev-list --left-right --count HEAD...@{upstream} 2>/dev/null || echo '0 0'", {
        encoding: "utf-8",
        cwd: repoPath,
        timeout: 5000,
      }).trim().split(/\s+/);
      ahead = parseInt(aheadBehind[0]) || 0;
      behind = parseInt(aheadBehind[1]) || 0;
    } catch {
    }

    const status: GitStatus = {
      current,
      tracking,
      ahead,
      behind,
      files,
    };

    return NextResponse.json(status);
  } catch (error) {
    console.error("[/api/git/status GET] Error:", error);
    return NextResponse.json({ error: "Failed to get git status" }, { status: 500 });
  }
}