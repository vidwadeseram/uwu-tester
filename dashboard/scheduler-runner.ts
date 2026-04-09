#!/usr/bin/env npx tsx
/**
 * uwu-code Scheduler Runner
 * Uses OpenCode Server API instead of CLI subprocess spawning.
 *
 * For each due task, calls the dashboard API which handles
 * server session creation and message sending.
 *
 * Usage:
 *   npx tsx dashboard/scheduler-runner.ts
 *   # or keep it running with: npx tsx dashboard/scheduler-runner.ts --watch
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const TASKS_FILE = path.join(REPO_ROOT, "openclaw", "data", "tasks.json");
const POLL_MS = 15_000;
const DASHBOARD_URL = process.env.DASHBOARD_URL || "http://localhost:3000";

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

async function runTaskViaDashboard(task: Task) {
  const now = new Date().toISOString();

  const tasks = load();
  const idx = tasks.findIndex(t => t.id === task.id);
  if (idx === -1) return;
  tasks[idx].status = "running";
  tasks[idx].started_at = now;

  const mode = task.schedule_mode;
  if (mode === "daily" && task.schedule_time) {
    const next = nextDailyUtc(task.schedule_time, new Date());
    if (next) tasks[idx].scheduled_at = next;
  } else if (mode === "weekly" && task.schedule_time && task.schedule_weekday !== undefined) {
    const next = nextWeeklyUtc(task.schedule_time, task.schedule_weekday, new Date());
    if (next) tasks[idx].scheduled_at = next;
  }

  save(tasks);

  try {
    const res = await fetch(`${DASHBOARD_URL}/api/scheduler/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "queue_now" }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[scheduler] Dashboard API error for task ${task.id}: ${res.status} ${body}`);
    } else {
      console.log(`[scheduler] spawned task ${task.id} (${task.title.slice(0, 50)}) via OpenCode Server`);
    }
  } catch (err) {
    console.error(`[scheduler] Failed to contact dashboard for task ${task.id}:`, err);
  }
}

function tick() {
  const now = new Date();
  const tasks = load();
  const due = tasks.filter(t => isDue(t, now));
  for (const task of due) {
    console.log(`[scheduler] due: ${task.id} "${task.title.slice(0, 60)}" (${task.status})`);
    runTaskViaDashboard(task);
  }
  if (due.length === 0) {
    process.stdout.write(".");
  }
}

console.log(`[scheduler] started — polling every ${POLL_MS / 1000}s (OpenCode Server mode)`);
console.log(`[scheduler] tasks file: ${TASKS_FILE}`);
console.log(`[scheduler] dashboard: ${DASHBOARD_URL}`);
tick();
setInterval(tick, POLL_MS);
