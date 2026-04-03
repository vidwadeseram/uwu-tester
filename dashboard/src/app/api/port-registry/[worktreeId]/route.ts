import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

export async function DELETE(
  request: NextRequest,
  { params }: { params: { worktreeId: string } }
) {
  try {
    const db = getDb();
    const worktreeId = params.worktreeId;

    const worktree = await db.select().from(schema.worktrees).where(eq(schema.worktrees.id, worktreeId)).get();
    if (!worktree) {
      return NextResponse.json({ error: "Worktree not found" }, { status: 404 });
    }

    if (!worktree.port) {
      return NextResponse.json({ message: "Worktree has no port assigned" });
    }

    await db.update(schema.worktrees).set({ port: undefined }).where(eq(schema.worktrees.id, worktreeId));

    await db.update(schema.portRegistry).set({ isActive: false, updatedAt: new Date() }).where(eq(schema.portRegistry.worktreeId, worktreeId));

    return NextResponse.json({ success: true, releasedPort: worktree.port });
  } catch (error) {
    console.error("[/api/port-registry/[worktreeId] DELETE] Error:", error);
    return NextResponse.json({ error: "Failed to release port" }, { status: 500 });
  }
}