import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "child_process";
import { safePath } from "@/lib/sanitize";
import { readdir, stat } from "fs/promises";
import { join } from "path";

interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  gitStatus?: "modified" | "added" | "deleted" | "untracked" | "renamed" | "copied" | "unmerged" | "unknown";
  children?: FileNode[];
}

function getGitStatus(filePath: string, repoPath: string): FileNode["gitStatus"] {
  try {
    const output = execFileSync("git", ["status", "--porcelain", filePath], {
      encoding: "utf-8",
      cwd: repoPath,
      timeout: 5000,
    }).toString().trim();

    if (!output) return undefined;

    const firstChar = output[0];
    const statusMap: Record<string, FileNode["gitStatus"]> = {
      "M": "modified",
      "A": "added",
      "D": "deleted",
      "?": "untracked",
      "R": "renamed",
      "C": "copied",
      "U": "unmerged",
    };

    return statusMap[firstChar] || "unknown";
  } catch {
    return undefined;
  }
}

async function buildFileTree(
  dirPath: string,
  repoPath: string,
  gitRoot: string,
  maxDepth: number = 10,
  currentDepth: number = 0
): Promise<FileNode[]> {
  if (currentDepth >= maxDepth) return [];

  const entries = await readdir(dirPath, { withFileTypes: true });
  const nodes: FileNode[] = [];

  for (const entry of entries) {
    if (entry.name === ".git") continue;

    const fullPath = join(dirPath, entry.name);
    const relativePath = fullPath.replace(gitRoot + "/", "");

    try {
      const stats = await stat(fullPath);
      const node: FileNode = {
        name: entry.name,
        path: relativePath,
        type: entry.isDirectory() ? "directory" : "file",
        size: stats.size,
      };

      if (entry.isDirectory()) {
        node.children = await buildFileTree(fullPath, repoPath, gitRoot, maxDepth, currentDepth + 1);
      } else {
        node.gitStatus = getGitStatus(fullPath, repoPath);
      }

      nodes.push(node);
    } catch {
      continue;
    }
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function findGitRoot(filePath: string): string | null {
  try {
    const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      cwd: filePath,
      timeout: 5000,
    }).trim();
    return gitRoot;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const worktreeId = searchParams.get("worktreeId");
    const path = searchParams.get("path") || "";

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
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

    const gitRoot = findGitRoot(repoPath);
    if (!gitRoot) {
      return NextResponse.json({ error: "Not a git repository" }, { status: 400 });
    }

    const targetPath = path ? safePath(repoPath, path) : repoPath;

    const tree = await buildFileTree(targetPath, repoPath, gitRoot);

    return NextResponse.json({ tree, gitRoot });
  } catch (error) {
    console.error("[/api/files/tree GET] Error:", error);
    return NextResponse.json({ error: "Failed to get file tree" }, { status: 500 });
  }
}
