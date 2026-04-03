import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";

const PROJECTS_ROOT = "/opt/workspaces";

function isWithinProjectsRoot(candidate: string): boolean {
  const normalizedRoot = path.resolve(PROJECTS_ROOT);
  const normalizedCandidate = path.resolve(candidate);
  if (normalizedCandidate === normalizedRoot) return false;
  return normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

function getGitBranch(dir: string): string {
  try {
    const { execSync } = require("child_process");
    return execSync(`git -C "${dir}" branch --show-current`, { encoding: "utf-8", timeout: 5000 }).trim();
  } catch {
    return "";
  }
}

function sanitizeRemoteUrl(remoteUrl: string): string {
  if (!remoteUrl) return "";
  try {
    const parsed = new URL(remoteUrl);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return remoteUrl.replace(/^(https?:\/\/)([^@/]+)@/i, "$1");
  }
}

function getGitRemote(dir: string): string {
  try {
    const { execSync } = require("child_process");
    return execSync(`git -C "${dir}" remote get-url origin`, { encoding: "utf-8", timeout: 5000 }).trim();
  } catch {
    return "";
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const db = getDb();
    
    const project = await db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
    
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    let branch = "";
    let remoteUrl = "";
    
    if (fs.existsSync(project.path)) {
      branch = getGitBranch(project.path);
      remoteUrl = sanitizeRemoteUrl(getGitRemote(project.path));
    }

    return NextResponse.json({
      project: {
        ...project,
        branch,
        remoteUrl,
      },
    });
  } catch (error) {
    console.error("[/api/projects/[id] GET] Error:", error);
    return NextResponse.json({ error: "Failed to fetch project" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = await request.json();
    const { name, defaultBranch, gitUrl } = body as {
      name?: string;
      defaultBranch?: string;
      gitUrl?: string;
    };

    const db = getDb();
    const existing = await db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
    
    if (!existing) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    
    if (name !== undefined) updates.name = name;
    if (defaultBranch !== undefined) updates.defaultBranch = defaultBranch;
    if (gitUrl !== undefined) updates.gitUrl = gitUrl;

    await db.update(schema.projects).set(updates).where(eq(schema.projects.id, id));

    const updated = await db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();

    return NextResponse.json({ success: true, project: updated });
  } catch (error) {
    console.error("[/api/projects/[id] PATCH] Error:", error);
    return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const db = getDb();
    
    const project = await db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
    
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const resolved = path.resolve(project.path);
    if (!isWithinProjectsRoot(resolved)) {
      return NextResponse.json({ error: "Invalid project path" }, { status: 400 });
    }

    if (fs.existsSync(resolved)) {
      fs.rmSync(resolved, { recursive: true, force: false });
    }

    await db.delete(schema.projects).where(eq(schema.projects.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[/api/projects/[id] DELETE] Error:", error);
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}
