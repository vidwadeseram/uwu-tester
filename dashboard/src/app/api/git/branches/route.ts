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

interface Branch {
  name: string;
  current: boolean;
  remote: boolean;
  tracking: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const worktreeId = searchParams.get("worktreeId");
    const projectId = searchParams.get("projectId");
    const all = searchParams.get("all") !== "false";

    const repoPath = getRepoPath(worktreeId || undefined, projectId || undefined);
    if (!repoPath) {
      return NextResponse.json({ error: "Worktree or project not found" }, { status: 404 });
    }

    const args = all ? ["branch", "-a", "--format=%(refname:short)|%(HEAD)|%(upstream:short)"] : ["branch", "--format=%(refname:short)|%(HEAD)|%(upstream:short)"];

    const output = execSync(`git ${args.join(" ")}`, {
      encoding: "utf-8",
      cwd: repoPath,
      timeout: 10000,
    });

    const branches: Branch[] = [];
    for (const line of output.split("\n").filter(Boolean)) {
      const [name, current, tracking] = line.split("|");
      if (name) {
        branches.push({
          name,
          current: current === "*",
          remote: name.startsWith("remotes/") || name.includes("/"),
          tracking: tracking || null,
        });
      }
    }

    return NextResponse.json({ branches });
  } catch (error) {
    console.error("[/api/git/branches GET] Error:", error);
    return NextResponse.json({ error: "Failed to get branches" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { worktreeId, projectId, name, startPoint } = body;

    const repoPath = getRepoPath(worktreeId, projectId);
    if (!repoPath) {
      return NextResponse.json({ error: "Worktree or project not found" }, { status: 404 });
    }

    if (!name || name.trim() === "") {
      return NextResponse.json({ error: "Branch name is required" }, { status: 400 });
    }

    const args = startPoint ? ["checkout", "-b", name, startPoint] : ["checkout", "-b", name];

    try {
      execSync(`git ${args.join(" ")}`, {
        cwd: repoPath,
        timeout: 10000,
      });
    } catch {
      execSync(`git branch "${name}" ${startPoint ? startPoint : ""}`, {
        cwd: repoPath,
        timeout: 10000,
      });
    }

    return NextResponse.json({ success: true, name });
  } catch (error) {
    console.error("[/api/git/branches POST] Error:", error);
    return NextResponse.json({ error: "Failed to create branch" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const worktreeId = searchParams.get("worktreeId");
    const projectId = searchParams.get("projectId");
    const name = searchParams.get("name");
    const remote = searchParams.get("remote") === "true";
    const force = searchParams.get("force") === "true";

    const repoPath = getRepoPath(worktreeId || undefined, projectId || undefined);
    if (!repoPath) {
      return NextResponse.json({ error: "Worktree or project not found" }, { status: 404 });
    }

    if (!name || name.trim() === "") {
      return NextResponse.json({ error: "Branch name is required" }, { status: 400 });
    }

    const flag = force ? "-D" : "-d";
    const branchName = remote ? `origin/${name}` : name;

    try {
      execSync(`git branch ${flag} "${branchName}"`, {
        cwd: repoPath,
        timeout: 10000,
      });
    } catch {
      execSync(`git push origin --delete "${name}"`, {
        cwd: repoPath,
        timeout: 10000,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[/api/git/branches DELETE] Error:", error);
    return NextResponse.json({ error: "Failed to delete branch" }, { status: 500 });
  }
}