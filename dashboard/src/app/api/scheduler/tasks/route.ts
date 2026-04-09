export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { runTaskViaServer } from "@/lib/opencode-server";

const DATA_DIR = path.join(process.cwd(), "..", "openclaw", "data");
const TASKS_FILE = path.join(DATA_DIR, "tasks.json");

async function spawnTask(task: Task): Promise<string> {
  await runTaskViaServer({
    taskId: task.id,
    title: task.title,
    description: task.description,
    workspace: task.workspace || "/opt/workspaces",
    type: task.type,
    preferredTool: task.preferred_tool,
  });
  return task.id;
}

type TaskStatus = "pending" | "running" | "completed" | "failed" | "scheduled" | "manual" | "rate_limited";
type ScheduleMode = "anytime" | "once" | "daily" | "weekly" | "manual";

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export interface Task {
  id: string;
  title: string;
  type: "coding" | "research";
  description: string;
  workspace?: string;
  preferred_tool?: "opencode" | "auto";
  status: TaskStatus;
  schedule_mode: ScheduleMode;
  schedule_time?: string;
  schedule_weekday?: number;
  created_at: string;
  scheduled_at?: string;
  started_at?: string;
  completed_at?: string;
  last_run_at?: string;
  last_run_status?: "completed" | "failed";
  retry_at?: string;
  report?: string;
  session_id?: string;
}

function normalizeIso(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function parseScheduleTime(value?: string): { hour: number; minute: number } | null {
  if (!value) return null;
  const m = value.match(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
  if (!m) return null;
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  return { hour, minute };
}

function computeNextDailyUtc(scheduleTime: string, now = new Date()): string | null {
  const parsed = parseScheduleTime(scheduleTime);
  if (!parsed) return null;

  const candidate = new Date(now);
  candidate.setUTCHours(parsed.hour, parsed.minute, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate.toISOString();
}

function computeNextWeeklyUtc(scheduleTime: string, weekday: number, now = new Date()): string | null {
  const parsed = parseScheduleTime(scheduleTime);
  if (!parsed) return null;
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;

  const candidate = new Date(now);
  const current = candidate.getUTCDay();
  let delta = (weekday - current + 7) % 7;

  candidate.setUTCDate(candidate.getUTCDate() + delta);
  candidate.setUTCHours(parsed.hour, parsed.minute, 0, 0);

  if (candidate.getTime() <= now.getTime()) {
    delta += 7;
    candidate.setUTCDate(now.getUTCDate() + delta);
    candidate.setUTCHours(parsed.hour, parsed.minute, 0, 0);
  }

  return candidate.toISOString();
}

function loadTasks(): Task[] {
  if (!fs.existsSync(TASKS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(TASKS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveTasks(tasks: Task[]) {
  ensureDir();
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

export async function GET() {
  ensureDir();
  return NextResponse.json({ tasks: loadTasks() });
}

export async function POST(req: NextRequest) {
  ensureDir();
  const body = await req.json() as Partial<Task> & {
    one_time_at?: string;
  };
  const {
    title,
    type,
    description,
    workspace,
    preferred_tool,
    schedule_mode,
    schedule_time,
    schedule_weekday,
    one_time_at,
  } = body;

  if (!description?.trim())
    return NextResponse.json({ error: "description required" }, { status: 400 });
  if (!type || !["coding", "research"].includes(type))
    return NextResponse.json({ error: "type must be coding or research" }, { status: 400 });

  const mode: ScheduleMode = schedule_mode ?? "anytime";
  if (!["anytime", "once", "daily", "weekly", "manual"].includes(mode)) {
    return NextResponse.json({ error: "invalid schedule_mode" }, { status: 400 });
  }

  let status: TaskStatus = "pending";
  let initialScheduledAt: string | undefined;
  let normalizedTime: string | undefined;
  let normalizedWeekday: number | undefined;

  if (mode === "once") {
    const when = normalizeIso(one_time_at ?? body.scheduled_at);
    if (!when) {
      return NextResponse.json({ error: "one_time_at (or scheduled_at) must be a valid date" }, { status: 400 });
    }
    if (new Date(when).getTime() <= Date.now()) {
      return NextResponse.json({ error: "one_time_at must be in the future" }, { status: 400 });
    }
    status = "scheduled";
    initialScheduledAt = when;
  }

  if (mode === "daily") {
    const next = computeNextDailyUtc(schedule_time ?? "");
    if (!next) {
      return NextResponse.json({ error: "daily schedules require schedule_time in HH:mm (UTC)" }, { status: 400 });
    }
    normalizedTime = schedule_time;
    status = "scheduled";
    initialScheduledAt = next;
  }

  if (mode === "weekly") {
    const next = computeNextWeeklyUtc(schedule_time ?? "", Number(schedule_weekday));
    if (!next) {
      return NextResponse.json({ error: "weekly schedules require schedule_time (HH:mm UTC) and schedule_weekday (0-6)" }, { status: 400 });
    }
    normalizedTime = schedule_time;
    normalizedWeekday = Number(schedule_weekday);
    status = "scheduled";
    initialScheduledAt = next;
  }

  if (mode === "manual") {
    status = "manual";
  }

  const task: Task = {
    id: randomUUID(),
    title: (title?.trim() || description.slice(0, 60)).trim(),
    type,
    description: description.trim(),
    workspace: type === "coding" ? (workspace || "/opt/workspaces") : undefined,
    preferred_tool: type === "coding" ? (preferred_tool || "auto") : undefined,
    status,
    schedule_mode: mode,
    schedule_time: normalizedTime,
    schedule_weekday: normalizedWeekday,
    scheduled_at: initialScheduledAt,
    created_at: new Date().toISOString(),
  };

  if (mode === "anytime") {
    task.status = "running";
    task.started_at = new Date().toISOString();
    try {
      task.session_id = await spawnTask(task);
    } catch (err) {
      console.error("[scheduler] Failed to spawn task via OpenCode Server:", err);
      task.status = "failed";
      task.report = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
    }
    const tasks = loadTasks();
    tasks.push(task);
    saveTasks(tasks);
    return NextResponse.json({ task }, { status: 201 });
  }

  const tasks = loadTasks();
  tasks.push(task);
  saveTasks(tasks);

  return NextResponse.json({ task }, { status: 201 });
}
