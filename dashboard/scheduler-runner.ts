#!/usr/bin/env npx tsx
/**
 * uwu-code Scheduler Runner
 * Replaces openclaw/agent.py for the Scheduler feature.
 *
 * The prompt for every task is simply its description — no complex agent layer.
 * Spawns `claude --dangerously-skip-permissions -p "<description>"` for each
 * due task and writes status back via the uwu-scheduler MCP (which the spawned
 * session loads from .mcp/config.json).
 *
 * Usage:
 *   npx tsx dashboard/scheduler-runner.ts
 *   # or keep it running with: npx tsx dashboard/scheduler-runner.ts --watch
 */

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const TASKS_FILE = path.join(REPO_ROOT, "openclaw", "data", "tasks.json");
const POLL_MS = 15_000;

type TaskStatus = "pending" | "running" | "completed" | "failed" | "scheduled" | "manual";

interface Task {
  id: string;
  title: string;
  type: "coding" | "research";
  description: string;
  workspace?: string;
  preferred_tool?: "claude" | "opencode" | "auto";
  status: TaskStatus;
  schedule_mode?: string;
  schedule_time?: string;
  schedule_weekday?: number;
  scheduled_at?: string;
  started_at?: string;
}

function load(): Task[] {
  if (!fs.existsSync(TASKS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(TASKS_FILE, "utf-8")); }
  catch { return []; }
}

function save(tasks: Task[]) {
  fs.mkdirSync(path.dirname(TASKS_FILE), { recursive: true });
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

/** The prompt IS the description — no transformation needed. */
function buildPrompt(task: Task): string {
  const ws = task.workspace || "/opt/workspaces";
  if (task.type === "coding") {
    return (
      `Execute this scheduled coding task: ${task.description}\n\n` +
      `Working directory: ${ws}\n\n` +
      `Use your tools fully. When done, call scheduler_update_task MCP: ` +
      `task_id="${task.id}", status="completed"/"failed", report=<summary>, ` +
      `completed_at=<ISO>, last_run_at=<ISO>, last_run_status="completed"/"failed".`
    );
  }
  return (
    `${task.description}\n\n` +
    `When done, call scheduler_update_task MCP: ` +
    `task_id="${task.id}", status="completed"/"failed", report=<findings>, ` +
    `completed_at=<ISO>, last_run_at=<ISO>, last_run_status="completed"/"failed".`
  );
}

function isDue(task: Task, now: Date): boolean {
  if (task.status === "pending") return true;
  if (task.status === "scheduled" && task.scheduled_at) {
    return new Date(task.scheduled_at) <= now;
  }
  return false;
}

function nextDailyUtc(scheduleTime: string, now: Date): string | null {
  const [h, m] = scheduleTime.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  const c = new Date(now);
  c.setUTCHours(h, m, 0, 0);
  if (c <= now) c.setUTCDate(c.getUTCDate() + 1);
  return c.toISOString();
}

function nextWeeklyUtc(scheduleTime: string, weekday: number, now: Date): string | null {
  const [h, m] = scheduleTime.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  const c = new Date(now);
  const delta = (weekday - c.getUTCDay() + 7) % 7;
  c.setUTCDate(c.getUTCDate() + delta);
  c.setUTCHours(h, m, 0, 0);
  if (c <= now) c.setUTCDate(c.getUTCDate() + 7);
  return c.toISOString();
}

function runTask(task: Task) {
  const prompt = buildPrompt(task);
  const now = new Date().toISOString();

  // Mark running before spawning
  const tasks = load();
  const idx = tasks.findIndex(t => t.id === task.id);
  if (idx === -1) return;
  tasks[idx].status = "running";
  tasks[idx].started_at = now;

  // If recurring, immediately compute and set next run so the task
  // doesn't get picked up again while the current run is in flight.
  const mode = task.schedule_mode;
  if (mode === "daily" && task.schedule_time) {
    const next = nextDailyUtc(task.schedule_time, new Date());
    if (next) tasks[idx].scheduled_at = next;
  } else if (mode === "weekly" && task.schedule_time && task.schedule_weekday !== undefined) {
    const next = nextWeeklyUtc(task.schedule_time, task.schedule_weekday, new Date());
    if (next) tasks[idx].scheduled_at = next;
  }

  save(tasks);

  const workspace = task.workspace || REPO_ROOT;
  const bin = task.preferred_tool === "claude" ? "claude" : "opencode";
  const args = bin === "claude"
    ? ["--dangerously-skip-permissions", "-p", prompt]
    : ["-p", prompt];
  const child = spawn(bin, args, { cwd: workspace, detached: true, stdio: "ignore" });
  child.unref();
  console.log(`[scheduler] spawned task ${task.id} (${task.title.slice(0, 50)}) tool=${bin} cwd=${workspace} pid=${child.pid}`);
}

function tick() {
  const now = new Date();
  const tasks = load();
  const due = tasks.filter(t => isDue(t, now));
  for (const task of due) {
    console.log(`[scheduler] due: ${task.id} "${task.title.slice(0, 60)}" (${task.status})`);
    runTask(task);
  }
  if (due.length === 0) {
    process.stdout.write(".");
  }
}

console.log(`[scheduler] started — polling every ${POLL_MS / 1000}s (openclaw-free)`);
console.log(`[scheduler] tasks file: ${TASKS_FILE}`);
tick();
setInterval(tick, POLL_MS);
