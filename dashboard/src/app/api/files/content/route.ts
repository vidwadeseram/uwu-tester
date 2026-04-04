import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { safePath } from "@/lib/sanitize";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const worktreeId = searchParams.get("worktreeId");
    const filePath = searchParams.get("path");

    if (!projectId || !filePath) {
      return NextResponse.json({ error: "projectId and path are required" }, { status: 400 });
    }

    let basePath: string;

    if (worktreeId) {
      const { getDb, schema } = await import("@/lib/db");
      const { eq } = await import("drizzle-orm");
      const db = getDb();
      const worktree = await db.select().from(schema.worktrees).where(eq(schema.worktrees.id, worktreeId)).get();
      if (!worktree) {
        return NextResponse.json({ error: "Worktree not found" }, { status: 404 });
      }
      basePath = worktree.path;
    } else {
      const { getDb, schema } = await import("@/lib/db");
      const { eq } = await import("drizzle-orm");
      const db = getDb();
      const project = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
      if (!project) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
      basePath = project.path;
    }

    const fullPath = safePath(basePath, filePath);

    try {
      const content = await readFile(fullPath, "utf-8");
      return NextResponse.json({ content });
    } catch {
      return NextResponse.json({ error: "File not found or cannot be read" }, { status: 404 });
    }
  } catch (error) {
    console.error("[/api/files/content GET] Error:", error);
    return NextResponse.json({ error: "Failed to read file" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, worktreeId, path, content } = body;

    if (!projectId || !path || content === undefined) {
      return NextResponse.json({ error: "projectId, path, and content are required" }, { status: 400 });
    }

    let basePath: string;

    if (worktreeId) {
      const { getDb, schema } = await import("@/lib/db");
      const { eq } = await import("drizzle-orm");
      const db = getDb();
      const worktree = await db.select().from(schema.worktrees).where(eq(schema.worktrees.id, worktreeId)).get();
      if (!worktree) {
        return NextResponse.json({ error: "Worktree not found" }, { status: 404 });
      }
      basePath = worktree.path;
    } else {
      const { getDb, schema } = await import("@/lib/db");
      const { eq } = await import("drizzle-orm");
      const db = getDb();
      const project = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
      if (!project) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
      basePath = project.path;
    }

    const fullPath = safePath(basePath, path);

    try {
      const { writeFile } = await import("fs/promises");
      await writeFile(fullPath, content, "utf-8");
      return NextResponse.json({ success: true });
    } catch {
      return NextResponse.json({ error: "Failed to write file" }, { status: 500 });
    }
  } catch (error) {
    console.error("[/api/files/content PUT] Error:", error);
    return NextResponse.json({ error: "Failed to write file" }, { status: 500 });
  }
}
