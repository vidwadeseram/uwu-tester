import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const PROJECTS_ROOT = "/opt/workspaces";

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

function getGitDefaultBranch(dir: string): string {
  try {
    const remoteHead = execFileSync("git", ["-C", dir, "symbolic-ref", "refs/remotes/origin/HEAD"], {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    const match = remoteHead.match(/refs\/remotes\/origin\/(.+)$/);
    return match ? match[1] : "main";
  } catch {
    return "main";
  }
}

interface DiscoveredProject {
  path: string;
  name: string;
  gitUrl: string | null;
  branch: string;
  defaultBranch: string;
  isTracked: boolean;
}

export async function GET() {
  try {
    const db = getDb();
    const trackedProjects = await db.select().from(schema.projects);
    const trackedPaths = new Set(trackedProjects.map(p => p.path));
    
    const discovered: DiscoveredProject[] = [];
    
    if (!fs.existsSync(PROJECTS_ROOT)) {
      fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
      return NextResponse.json({ projects: [], untracked: [] });
    }
    
    const entries = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const projectPath = path.join(PROJECTS_ROOT, entry.name);
      
      if (!isWithinProjectsRoot(projectPath)) continue;
      
      if (fs.existsSync(path.join(projectPath, ".git"))) {
        const branch = getGitBranch(projectPath);
        const remoteUrl = sanitizeRemoteUrl(getGitRemote(projectPath));
        const defaultBranch = getGitDefaultBranch(projectPath);
        
        discovered.push({
          path: projectPath,
          name: entry.name,
          gitUrl: remoteUrl || null,
          branch,
          defaultBranch,
          isTracked: trackedPaths.has(projectPath),
        });
      } else {
        const subEntries = fs.readdirSync(projectPath, { withFileTypes: true });
        for (const sub of subEntries) {
          if (!sub.isDirectory()) continue;
          const subPath = path.join(projectPath, sub.name);
          if (!isWithinProjectsRoot(subPath)) continue;
          if (!fs.existsSync(path.join(subPath, ".git"))) continue;
          
          const branch = getGitBranch(subPath);
          const remoteUrl = sanitizeRemoteUrl(getGitRemote(subPath));
          const defaultBranch = getGitDefaultBranch(subPath);
          
          discovered.push({
            path: subPath,
            name: sub.name,
            gitUrl: remoteUrl || null,
            branch,
            defaultBranch,
            isTracked: trackedPaths.has(subPath),
          });
        }
      }
    }
    
    const tracked = discovered.filter(p => p.isTracked);
    const untracked = discovered.filter(p => !p.isTracked);
    
    return NextResponse.json({
      projects: tracked,
      untracked,
      trackedCount: tracked.length,
      untrackedCount: untracked.length,
    });
  } catch (error) {
    console.error("[/api/projects/discover GET] Error:", error);
    return NextResponse.json({ error: "Failed to discover projects" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { paths } = body as { paths?: string[] };
    
    if (!paths || !Array.isArray(paths) || paths.length === 0) {
      return NextResponse.json({ error: "paths array is required" }, { status: 400 });
    }
    
    const db = getDb();
    const trackedProjects = await db.select().from(schema.projects);
    const trackedPaths = new Set(trackedProjects.map(p => p.path));
    
    const imported: Array<{ id: string; name: string; path: string; gitUrl: string | null }> = [];
    const errors: Array<{ path: string; error: string }> = [];
    
    for (const projectPath of paths) {
      if (!isWithinProjectsRoot(projectPath)) {
        errors.push({ path: projectPath, error: "Path is not within /opt/workspaces" });
        continue;
      }
      
      if (trackedPaths.has(projectPath)) {
        errors.push({ path: projectPath, error: "Project already tracked" });
        continue;
      }
      
      if (!fs.existsSync(projectPath)) {
        errors.push({ path: projectPath, error: "Path does not exist" });
        continue;
      }
      
      if (!fs.existsSync(path.join(projectPath, ".git"))) {
        errors.push({ path: projectPath, error: "Not a git repository" });
        continue;
      }
      
      const name = path.basename(projectPath);
      const gitUrl = sanitizeRemoteUrl(getGitRemote(projectPath)) || null;
      const defaultBranch = getGitDefaultBranch(projectPath);
      const id = randomUUID();
      const now = new Date();
      
      await db.insert(schema.projects).values({
        id,
        name,
        path: projectPath,
        gitUrl,
        defaultBranch,
        createdAt: now,
        updatedAt: now,
      });
      
      imported.push({ id, name, path: projectPath, gitUrl });
    }
    
    return NextResponse.json({
      imported,
      errors,
      importedCount: imported.length,
      errorCount: errors.length,
    });
  } catch (error) {
    console.error("[/api/projects/discover POST] Error:", error);
    return NextResponse.json({ error: "Failed to import projects" }, { status: 500 });
  }
}