import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { projectId } = body;

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const db = getDb();
    const spaceId = params.id;

    const space = await db.select().from(schema.spaces).where(eq(schema.spaces.id, spaceId)).get();
    if (!space) {
      return NextResponse.json({ error: "Space not found" }, { status: 404 });
    }

    const project = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const existing = await db
      .select()
      .from(schema.spaceProjects)
      .where(and(eq(schema.spaceProjects.spaceId, spaceId), eq(schema.spaceProjects.projectId, projectId)))
      .get();

    if (existing) {
      return NextResponse.json({ message: "Project already in space" });
    }

    await db.insert(schema.spaceProjects).values({
      id: randomUUID(),
      spaceId,
      projectId,
      position: 0,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[/api/spaces/[id]/projects POST] Error:", error);
    return NextResponse.json({ error: "Failed to add project to space" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const db = getDb();
    await db
      .delete(schema.spaceProjects)
      .where(and(eq(schema.spaceProjects.spaceId, params.id), eq(schema.spaceProjects.projectId, projectId)));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[/api/spaces/[id]/projects DELETE] Error:", error);
    return NextResponse.json({ error: "Failed to remove project from space" }, { status: 500 });
  }
}