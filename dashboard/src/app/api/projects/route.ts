import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { execFileSync } from "child_process";
import { validateProjectName } from "@/lib/sanitize";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const PROJECTS_ROOT = "/opt/workspaces";

function deriveRepoName(url: string): string {
  const clean = url.replace(/\.git$/, "");
  const parts = clean.split("/");
  return parts[parts.length - 1] || "repo";
}

function isWithinProjectsRoot(candidate: string): boolean {
  const normalizedRoot = path.resolve(PROJECTS_ROOT);
  const normalizedCandidate = path.resolve(candidate);
  if (normalizedCandidate === normalizedRoot) return false;
  return normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
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

function getGitBranch(dir: string): string {
  try {
    return execFileSync("git", ["-C", dir, "branch", "--show-current"], {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return "";
  }
}

function getGitRemote(dir: string): string {
  try {
    return execFileSync("git", ["-C", dir, "remote", "get-url", "origin"], {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return "";
  }
}

export async function GET() {
  try {
    const db = getDb();
    const allProjects = await db.select().from(schema.projects);
    
    const projectsWithMeta = await Promise.all(
      allProjects.map(async (project) => {
        let branch = "";
        let remoteUrl = "";
        
        if (fs.existsSync(project.path)) {
          branch = getGitBranch(project.path);
          remoteUrl = sanitizeRemoteUrl(getGitRemote(project.path));
        }
        
        return {
          ...project,
          branch,
          remoteUrl,
        };
      })
    );
    
    return NextResponse.json({ projects: projectsWithMeta });
  } catch (error) {
    console.error("[/api/projects GET] Error:", error);
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, gitUrl, defaultBranch = "main" } = body as {
      name?: string;
      gitUrl?: string;
      defaultBranch?: string;
    };

    if (!name || typeof name !== "string") {
      return NextResponse.json({ success: false, message: "name is required" }, { status: 400 });
    }

    const id = randomUUID();
    // Validate project name and path safety
    validateProjectName(name);
    const projectPath = path.join(PROJECTS_ROOT, name);
    if (!isWithinProjectsRoot(projectPath)) {
      return NextResponse.json({ success: false, message: "Invalid project path" }, { status: 400 });
    }

    if (fs.existsSync(projectPath)) {
      return NextResponse.json(
        { success: false, message: `Project path already exists: ${projectPath}` },
        { status: 409 }
      );
    }

    let finalPath = projectPath;
    let cloneMessage = "";

    if (gitUrl && typeof gitUrl === "string") {
      const repoName = deriveRepoName(gitUrl);
      finalPath = path.join(PROJECTS_ROOT, repoName);

      if (fs.existsSync(finalPath)) {
        return NextResponse.json(
          { success: false, message: `Repository already exists: ${finalPath}` },
          { status: 409 }
        );
      }

      try {
        execFileSync("git", ["clone", "--depth=1", gitUrl, finalPath], {
          encoding: "utf-8",
          timeout: 60000,
        });
        cloneMessage = `Cloned from ${gitUrl}`;
      } catch (error) {
        return NextResponse.json(
          { success: false, message: "Failed to clone repository" },
          { status: 500 }
        );
      }
    } else {
      fs.mkdirSync(finalPath, { recursive: true });
      cloneMessage = "Created empty project directory";
    }

    const now = new Date();
    const db = getDb();
    
    await db.insert(schema.projects).values({
      id,
      name,
      path: finalPath,
      gitUrl: gitUrl || null,
      defaultBranch,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({
      success: true,
      message: `${cloneMessage}`,
      project: {
        id,
        name,
        path: finalPath,
        gitUrl,
        defaultBranch,
      },
    });
  } catch (error) {
    console.error("[/api/projects POST] Error:", error);
    return NextResponse.json({ success: false, message: "Failed to create project" }, { status: 500 });
  }
}
