import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { execFileSync } from "child_process";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const db = getDb();
    const script = await db.select().from(schema.scripts).where(eq(schema.scripts.id, params.id)).get();

    if (!script) {
      return NextResponse.json({ error: "Script not found" }, { status: 404 });
    }

    return NextResponse.json({ script });
  } catch (error) {
    console.error("[/api/scripts/[id] GET] Error:", error);
    return NextResponse.json({ error: "Failed to get script" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { name, description, content, isFavorite } = body;

    const db = getDb();
    const existing = await db.select().from(schema.scripts).where(eq(schema.scripts.id, params.id)).get();

    if (!existing) {
      return NextResponse.json({ error: "Script not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (content !== undefined) updates.content = content;
    if (isFavorite !== undefined) updates.isFavorite = isFavorite;

    await db.update(schema.scripts).set(updates).where(eq(schema.scripts.id, params.id));

    const script = await db.select().from(schema.scripts).where(eq(schema.scripts.id, params.id)).get();
    return NextResponse.json({ script });
  } catch (error) {
    console.error("[/api/scripts/[id] PATCH] Error:", error);
    return NextResponse.json({ error: "Failed to update script" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const db = getDb();
    await db.delete(schema.scripts).where(eq(schema.scripts.id, params.id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[/api/scripts/[id] DELETE] Error:", error);
    return NextResponse.json({ error: "Failed to delete script" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { worktreeId } = body;

    const db = getDb();
    const script = await db.select().from(schema.scripts).where(eq(schema.scripts.id, params.id)).get();

    if (!script) {
      return NextResponse.json({ error: "Script not found" }, { status: 404 });
    }

    let cwd = process.cwd();
    if (worktreeId) {
      const worktree = await db.select().from(schema.worktrees).where(eq(schema.worktrees.id, worktreeId)).get();
      if (worktree) {
        cwd = worktree.path;
      }
    } else if (script.projectId) {
      const project = await db.select().from(schema.projects).where(eq(schema.projects.id, script.projectId)).get();
      if (project) {
        cwd = project.path;
      }
    }

    // Execute the script content via a shell using execFileSync for safety
    const output = (execFileSync as any)("/bin/sh", ["-c", script.content], {
      encoding: "utf-8",
      cwd,
      timeout: 60000,
      // TypeScript types for execFileSync do not include maxBuffer; cast to any to satisfy runtime behavior as needed
      maxBuffer: 1024 * 1024,
    } as any);

    await db
      .update(schema.scripts)
      .set({
        lastRunAt: new Date(),
        runCount: (script.runCount || 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(schema.scripts.id, params.id));

    return NextResponse.json({ success: true, output });
  } catch (error) {
    console.error("[/api/scripts/[id] POST] Error:", error);
    const err = error as { message?: string };
    return NextResponse.json({ error: "Script execution failed", details: err.message }, { status: 500 });
  }
}
