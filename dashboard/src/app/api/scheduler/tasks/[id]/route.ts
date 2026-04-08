export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { spawn, execSync } from "child_process";

const TASKS_FILE = path.join(process.cwd(), "..", "openclaw", "data", "tasks.json");
const REPO_ROOT = path.resolve(process.cwd(), "..");

function createTmuxSession(taskId: string, cwd: string): string {
  const sessionName = `uwu-${taskId.slice(0, 8)}`;
  try {
    execSync(`tmux new-session -d -s "${sessionName}" -c "${cwd}" 2>/dev/null || true`, { timeout: 5000 });
  } catch { /* ignore */ }
  return sessionName;
}

function spawnTask(task: Record<string, unknown>) {
  const title = String(task.title || "task");
  const description = String(task.description || "");
  const id = String(task.id);
  const workspace = String(task.workspace || "/opt/workspaces");
  const preferredTool = String(task.preferred_tool || "opencode");

  const prompt = task.type === "coding"
    ? `You are executing scheduled coding task "${title}".\n\nDescription: ${description}\nTarget workspace: ${workspace}\n\nUse your tools to complete this task fully.\n\nWhen done, call scheduler_update_task MCP: task_id="${id}", status="completed"/"failed", report=<summary>, completed_at=<ISO>, last_run_at=<ISO>, last_run_status="completed"/"failed".`
    : `You are executing scheduled research task "${title}".\n\nTask: ${description}\n\nResearch and answer this thoroughly.\n\nWhen done, call scheduler_update_task MCP: task_id="${id}", status="completed"/"failed", report=<findings>, completed_at=<ISO>, last_run_at=<ISO>, last_run_status="completed"/"failed".`;

  const tmuxSession = createTmuxSession(id, workspace);

  const bin = preferredTool === "claude" ? "claude" : "opencode";
  const escapedPrompt = prompt.replace(/'/g, "'\\''");
  const cmd = bin === "claude"
    ? `claude --dangerously-skip-permissions -p '${escapedPrompt}'`
    : `opencode -p '${escapedPrompt}'`;

  spawn("tmux", ["send-keys", "-t", tmuxSession, cmd, "Enter"], { cwd: REPO_ROOT });
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
    spawnTask(tasks[idx]);
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
      const sessionName = `uwu-${id.slice(0, 8)}`;
      try {
        execSync(`tmux kill-session -t "${sessionName}" 2>/dev/null || true`, { timeout: 5000 });
      } catch { /* ignore */ }
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
