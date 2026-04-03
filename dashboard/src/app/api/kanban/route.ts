import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

export async function GET() {
  try {
    const db = getDb();
    const tickets = await db.select().from(schema.kanbanTickets).orderBy(schema.kanbanTickets.position);
    return NextResponse.json({ tickets });
  } catch (error) {
    console.error("[/api/kanban GET] Error:", error);
    return NextResponse.json({ error: "Failed to get tickets" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, description, column, priority, assignee, labels, dueDate } = body;

    if (!title || !column) {
      return NextResponse.json({ error: "title and column are required" }, { status: 400 });
    }

    const db = getDb();
    const existingTickets = await db.select().from(schema.kanbanTickets).where(eq(schema.kanbanTickets.column, column));
    const maxPosition = existingTickets.length > 0 
      ? Math.max(...existingTickets.map(t => t.position)) + 1 
      : 0;

    const id = randomUUID();
    const now = new Date();

    await db.insert(schema.kanbanTickets).values({
      id,
      title,
      description: description || null,
      column,
      position: dueDate ? new Date(dueDate).getTime() : maxPosition,
      priority: priority || "medium",
      assignee: assignee || null,
      labels: labels || null,
      dueDate: dueDate ? new Date(dueDate) : null,
      createdAt: now,
      updatedAt: now,
    });

    const ticket = await db.select().from(schema.kanbanTickets).where(eq(schema.kanbanTickets.id, id)).get();
    return NextResponse.json({ ticket }, { status: 201 });
  } catch (error) {
    console.error("[/api/kanban POST] Error:", error);
    return NextResponse.json({ error: "Failed to create ticket" }, { status: 500 });
  }
}