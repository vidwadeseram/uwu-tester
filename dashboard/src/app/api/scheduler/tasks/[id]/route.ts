export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { runTaskViaServer, abortTask as abortServerTask } from "@/lib/opencode-server";

const TASKS_FILE = path.join(process.cwd(), "..", "openclaw", "data", "tasks.json");

async function spawnTask(task: Record<string, unknown>) {
  await runTaskViaServer({
    taskId: String(task.id),
    title: String(task.title || "task"),
    description: String(task.description || ""),
    workspace: String(task.workspace || "/opt/workspaces"),
    type: (task.type as "coding" | "research") || "coding",
    preferredTool: (task.preferred_tool as "opencode" | "claude" | "auto") || "opencode",
  });
}

function load(): object[] {
  if (!fs.existsSync(TASKS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(TASKS_FILE, "utf-8")); }
  catch { return []; }
}

function save(tasks: object[]) {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

type Context = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Context) {
  const { id } = await ctx.params;
  const tasks = load() as Array<Record<string, unknown> & { id: string }>;
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const patch = await req.json() as Record<string, unknown> & { action?: "queue_now" };
  const current = tasks[idx];

  if (patch.action === "queue_now") {
    tasks[idx] = {
      ...current,
      status: "running",
      started_at: new Date().toISOString(),
      completed_at: undefined,
    };
    delete tasks[idx].completed_at;
    save(tasks);
    spawnTask(tasks[idx]).catch((err) => {
      console.error("[scheduler] Failed to spawn task:", err);
      tasks[idx].status = "failed";
      tasks[idx].report = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
      save(tasks);
    });
    return NextResponse.json({ task: tasks[idx] });
  } else {
    const next = { ...current, ...patch };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) {
        delete next[key];
      }
    }
    delete next.action;
    tasks[idx] = next;

    if (patch.status === "completed" || patch.status === "failed") {
      try { await abortServerTask(id); } catch { /* session may already be gone */ }
    }
  }

  save(tasks);
  return NextResponse.json({ task: tasks[idx] });
}

export async function DELETE(_req: NextRequest, ctx: Context) {
  const { id } = await ctx.params;
  const tasks = load() as Array<{ id: string }>;
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [removed] = tasks.splice(idx, 1);
  save(tasks);
  return NextResponse.json({ task: removed });
}
