import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

const DEFAULT_PORT_START = 3000;
const DEFAULT_PORT_END = 9000;

export async function GET() {
  try {
    const db = getDb();
    const assignments = await db.select().from(schema.portRegistry).where(eq(schema.portRegistry.isActive, true));
    return NextResponse.json({ assignments });
  } catch (error) {
    console.error("[/api/port-registry GET] Error:", error);
    return NextResponse.json({ error: "Failed to get port assignments" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { worktreeId, port: requestedPort } = body;

    if (!worktreeId) {
      return NextResponse.json({ error: "worktreeId is required" }, { status: 400 });
    }

    const db = getDb();
    const now = new Date();

    // Check if worktree already has a port
    const existing = await db.select().from(schema.worktrees).where(eq(schema.worktrees.id, worktreeId)).get();
    if (!existing) {
      return NextResponse.json({ error: "Worktree not found" }, { status: 404 });
    }

    if (existing.port) {
      return NextResponse.json({ port: existing.port, worktreeId, message: "Worktree already has a port assigned" });
    }

    let assignedPort: number;

    if (requestedPort) {
      // Check if requested port is available
      const usedPorts = await db.select().from(schema.worktrees).where(eq(schema.worktrees.port, requestedPort));
      if (usedPorts.length > 0) {
        return NextResponse.json({ error: "Port is already in use" }, { status: 409 });
      }
      assignedPort = requestedPort;
    } else {
      // Auto-assign a port
      const usedPorts = await db.select({ port: schema.worktrees.port }).from(schema.worktrees);
      const usedSet = new Set(usedPorts.map((p) => p.port).filter((p) => p !== null));

      assignedPort = DEFAULT_PORT_START;
      while (usedSet.has(assignedPort) && assignedPort < DEFAULT_PORT_END) {
        assignedPort++;
      }

      if (assignedPort >= DEFAULT_PORT_END) {
        return NextResponse.json({ error: "No available ports in range" }, { status: 507 });
      }
    }

    // Assign port to worktree
    await db
      .update(schema.worktrees)
      .set({ port: assignedPort })
      .where(eq(schema.worktrees.id, worktreeId));

    // Create port registry entry
    await db.insert(schema.portRegistry).values({
      id: randomUUID(),
      worktreeId,
      port: assignedPort,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ port: assignedPort, worktreeId }, { status: 201 });
  } catch (error) {
    console.error("[/api/port-registry POST] Error:", error);
    return NextResponse.json({ error: "Failed to assign port" }, { status: 500 });
  }
}