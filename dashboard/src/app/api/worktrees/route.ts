import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
// Import dynamically to avoid TS type issues across environments
const { execFileSync } = require("child_process");
import { randomUUID } from "crypto";
import path from "path";

function runCommand(cmd: string): string {
  try {
    // Use a shell to execute commands to preserve multi-step logic
    return execFileSync("/bin/sh", ["-lc", cmd], { encoding: "utf-8", timeout: 10000 }).trim();
  } catch (err) {
    return "";
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");

    const db = getDb();
    
    let worktrees: typeof schema.worktrees.$inferSelect[];
    if (projectId) {
      worktrees = await db.select().from(schema.worktrees).where(eq(schema.worktrees.projectId, projectId));
    } else {
      worktrees = await db.select().from(schema.worktrees);
    }

    const worktreesWithStatus = await Promise.all(
      worktrees.map(async (wt) => {
        const isOnDisk = runCommand(`test -d "${wt.path}" && echo "yes" || echo "no"`) === "yes";
        let currentBranch = "";
        if (isOnDisk) {
          currentBranch = runCommand(`git -C "${wt.path}" branch --show-current`);
        }
        return {
          ...wt,
          isOnDisk,
          currentBranch,
        };
      })
    );

    return NextResponse.json({ worktrees: worktreesWithStatus });
  } catch (error) {
    console.error("[/api/worktrees GET] Error:", error);
    return NextResponse.json({ error: "Failed to fetch worktrees" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, name, branch, sourceBranch, isNewBranch = false } = body as {
      projectId: string;
      name: string;
      branch?: string;
      sourceBranch?: string;
      isNewBranch?: boolean;
    };

    if (!projectId || !name) {
      return NextResponse.json({ error: "projectId and name are required" }, { status: 400 });
    }

    const db = getDb();
    const project = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
    
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const worktreePath = path.join(project.path, name);

    if (runCommand(`test -d "${worktreePath}" && echo "exists" || echo "no"`)) {
      return NextResponse.json({ error: "Worktree path already exists" }, { status: 409 });
    }

    const branchName = branch || name;

    let createCmd = "";
    if (isNewBranch && sourceBranch) {
      createCmd = `git worktree add -b "${branchName}" "${worktreePath}" "${sourceBranch}"`;
    } else if (isNewBranch) {
      createCmd = `git worktree add -b "${branchName}" "${worktreePath}"`;
    } else {
      createCmd = `git worktree add "${worktreePath}" "${sourceBranch || branchName}"`;
    }

    try {
      runCommand(`cd "${project.path}" && ${createCmd}`);
    } catch {
      return NextResponse.json({ error: "Failed to create worktree" }, { status: 500 });
    }

    const id = randomUUID();
    const now = new Date();

    await db.insert(schema.worktrees).values({
      id,
      projectId,
      name,
      path: worktreePath,
      branch: branchName,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const worktree = await db.select().from(schema.worktrees).where(eq(schema.worktrees.id, id)).get();

    return NextResponse.json({ success: true, worktree });
  } catch (error) {
    console.error("[/api/worktrees POST] Error:", error);
    return NextResponse.json({ error: "Failed to create worktree" }, { status: 500 });
  }
}
