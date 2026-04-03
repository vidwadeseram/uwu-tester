import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const db = getDb();
    const ticket = await db.select().from(schema.kanbanTickets).where(eq(schema.kanbanTickets.id, params.id)).get();

    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    return NextResponse.json({ ticket });
  } catch (error) {
    console.error("[/api/kanban/[id] GET] Error:", error);
    return NextResponse.json({ error: "Failed to get ticket" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { title, description, column, position, priority, assignee, labels, dueDate } = body;

    const db = getDb();
    const existing = await db.select().from(schema.kanbanTickets).where(eq(schema.kanbanTickets.id, params.id)).get();

    if (!existing) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (column !== undefined) updates.column = column;
    if (position !== undefined) updates.position = position;
    if (priority !== undefined) updates.priority = priority;
    if (assignee !== undefined) updates.assignee = assignee;
    if (labels !== undefined) updates.labels = labels;
    if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null;

    await db.update(schema.kanbanTickets).set(updates).where(eq(schema.kanbanTickets.id, params.id));

    const ticket = await db.select().from(schema.kanbanTickets).where(eq(schema.kanbanTickets.id, params.id)).get();
    return NextResponse.json({ ticket });
  } catch (error) {
    console.error("[/api/kanban/[id] PATCH] Error:", error);
    return NextResponse.json({ error: "Failed to update ticket" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const db = getDb();
    await db.delete(schema.kanbanTickets).where(eq(schema.kanbanTickets.id, params.id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[/api/kanban/[id] DELETE] Error:", error);
    return NextResponse.json({ error: "Failed to delete ticket" }, { status: 500 });
  }
}