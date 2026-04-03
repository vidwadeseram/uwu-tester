import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const db = getDb();
    const space = await db.select().from(schema.spaces).where(eq(schema.spaces.id, params.id)).get();

    if (!space) {
      return NextResponse.json({ error: "Space not found" }, { status: 404 });
    }

    const spaceProjects = await db
      .select({ projectId: schema.spaceProjects.projectId })
      .from(schema.spaceProjects)
      .where(eq(schema.spaceProjects.spaceId, params.id));

    const projects = await Promise.all(
      spaceProjects.map(async (sp) => {
        const project = await db
          .select()
          .from(schema.projects)
          .where(eq(schema.projects.id, sp.projectId))
          .get();
        return project;
      })
    );

    return NextResponse.json({ space: { ...space, projects: projects.filter(Boolean) } });
  } catch (error) {
    console.error("[/api/spaces/[id] GET] Error:", error);
    return NextResponse.json({ error: "Failed to get space" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { name, description, color } = body;

    const db = getDb();
    const existing = await db.select().from(schema.spaces).where(eq(schema.spaces.id, params.id)).get();

    if (!existing) {
      return NextResponse.json({ error: "Space not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (color !== undefined) updates.color = color;

    await db.update(schema.spaces).set(updates).where(eq(schema.spaces.id, params.id));

    const space = await db.select().from(schema.spaces).where(eq(schema.spaces.id, params.id)).get();
    return NextResponse.json({ space });
  } catch (error) {
    console.error("[/api/spaces/[id] PATCH] Error:", error);
    return NextResponse.json({ error: "Failed to update space" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const db = getDb();
    await db.delete(schema.spaces).where(eq(schema.spaces.id, params.id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[/api/spaces/[id] DELETE] Error:", error);
    return NextResponse.json({ error: "Failed to delete space" }, { status: 500 });
  }
}