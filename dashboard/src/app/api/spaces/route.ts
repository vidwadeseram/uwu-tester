import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

export async function GET() {
  try {
    const db = getDb();
    const allSpaces = await db.select().from(schema.spaces);

    const spacesWithProjects = await Promise.all(
      allSpaces.map(async (space) => {
        const spaceProjects = await db
          .select({ projectId: schema.spaceProjects.projectId })
          .from(schema.spaceProjects)
          .where(eq(schema.spaceProjects.spaceId, space.id));

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

        return {
          ...space,
          projects: projects.filter(Boolean),
        };
      })
    );

    return NextResponse.json({ spaces: spacesWithProjects });
  } catch (error) {
    console.error("[/api/spaces GET] Error:", error);
    return NextResponse.json({ error: "Failed to get spaces" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, color } = body;

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const db = getDb();
    const id = randomUUID();
    const now = new Date();

    await db.insert(schema.spaces).values({
      id,
      name,
      description: description || null,
      color: color || "#00ff88",
      position: 0,
      createdAt: now,
      updatedAt: now,
    });

    const space = await db.select().from(schema.spaces).where(eq(schema.spaces.id, id)).get();
    return NextResponse.json({ space }, { status: 201 });
  } catch (error) {
    console.error("[/api/spaces POST] Error:", error);
    return NextResponse.json({ error: "Failed to create space" }, { status: 500 });
  }
}