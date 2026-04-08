#!/usr/bin/env node
/**
 * MCP Server for uwu-code Scheduler
 * Exposes Scheduler task management and execution via Model Context Protocol.
 *
 * Execution model (no openclaw daemon required):
 *   scheduler_run_task builds the prompt for a task and spawns
 *   `claude --dangerously-skip-permissions -p <prompt>` as a detached subprocess.
 *   The spawned Claude session has access to this MCP server and calls
 *   scheduler_update_task to write back its status/report when done.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { spawn, execSync } from "child_process";

// __dirname is the dashboard/ directory; tasks live in ../openclaw/data/
const DATA_DIR = path.resolve(__dirname, "..", "openclaw", "data");
const TASKS_FILE = path.join(DATA_DIR, "tasks.json");

// Repo root — spawned `claude` processes run from here so they load .mcp/config.json
const REPO_ROOT = path.resolve(__dirname, "..");

type TaskStatus = "pending" | "running" | "completed" | "failed" | "scheduled" | "manual";
type ScheduleMode = "anytime" | "once" | "daily" | "weekly" | "manual";

interface Task {
  id: string;
  title: string;
  type: "coding" | "research";
  description: string;
  workspace?: string;
  preferred_tool?: "claude" | "opencode" | "auto";
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
  report?: string;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadTasks(): Task[] {
  if (!fs.existsSync(TASKS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(TASKS_FILE, "utf-8")); }
  catch { return []; }
}

function saveTasks(tasks: Task[]) {
  ensureDataDir();
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildExecutionPrompt(task: Task): string {
  const header = `You are executing a scheduled uwu-code task.

Task ID: ${task.id}
Title: ${task.title}
Type: ${task.type}
`;

  const footer = `
When complete, call the scheduler_update_task MCP tool with:
  task_id: "${task.id}"
  status: "completed"  (or "failed" if you could not complete it)
  report: detailed summary of what was done / your findings
  completed_at: <current ISO 8601 timestamp>
  last_run_at: <current ISO 8601 timestamp>
  last_run_status: "completed"  (or "failed")`;

  if (task.type === "coding") {
    const workspace = task.workspace || "/opt/workspaces";
    return `${header}
Description: ${task.description}
Target workspace: ${workspace}

Use your tools (Bash, Edit, Write, etc.) to complete this coding task fully.
Work inside the target workspace directory.
${footer}`;
  }

  return `${header}
Task: ${task.description}

Research and answer this thoroughly. Use WebSearch or WebFetch if helpful.
${footer}`;
}

// ── Tool schemas ──────────────────────────────────────────────────────────────

const LIST_TASKS_TOOL: Tool = {
  name: "scheduler_list_tasks",
  description: "List all tasks in the Scheduler queue.",
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        description: "Filter by status",
        enum: ["pending", "running", "completed", "failed", "scheduled", "manual"],
      },
      type: { type: "string", enum: ["coding", "research"] },
    },
  },
};

const CREATE_TASK_TOOL: Tool = {
  name: "scheduler_create_task",
  description: "Create a new task in the Scheduler queue.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string", description: "Full task instructions" },
      type: { type: "string", enum: ["coding", "research"] },
      workspace: { type: "string", description: "For coding tasks: workspace path" },
      preferred_tool: { type: "string", enum: ["auto", "claude", "opencode"] },
      schedule_mode: {
        type: "string",
        enum: ["anytime", "manual", "once", "daily", "weekly"],
      },
      schedule_time: { type: "string", description: "HH:mm UTC for daily/weekly" },
      schedule_weekday: { type: "number", description: "0=Sun…6=Sat for weekly" },
      one_time_at: { type: "string", description: "ISO timestamp for once mode" },
    },
    required: ["description", "type"],
  },
};

const GET_TASK_TOOL: Tool = {
  name: "scheduler_get_task",
  description: "Get a task by ID.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string" },
    },
    required: ["task_id"],
  },
};

const UPDATE_TASK_TOOL: Tool = {
  name: "scheduler_update_task",
  description: "Update a task's properties. Spawned execution sessions use this to write back results.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      status: {
        type: "string",
        enum: ["pending", "running", "completed", "failed", "scheduled", "manual"],
      },
      report: { type: "string", description: "Execution output / research findings" },
      schedule_mode: { type: "string", enum: ["anytime", "manual", "once", "daily", "weekly"] },
      schedule_time: { type: "string" },
      schedule_weekday: { type: "number" },
      scheduled_at: { type: "string", description: "ISO timestamp for next run" },
      started_at: { type: "string" },
      completed_at: { type: "string" },
      last_run_at: { type: "string" },
      last_run_status: { type: "string", enum: ["completed", "failed"] },
    },
    required: ["task_id"],
  },
};

const DELETE_TASK_TOOL: Tool = {
  name: "scheduler_delete_task",
  description: "Delete a task.",
  inputSchema: {
    type: "object",
    properties: { task_id: { type: "string" } },
    required: ["task_id"],
  },
};

const QUEUE_NOW_TOOL: Tool = {
  name: "scheduler_queue_now",
  description: "Immediately queue a manual or scheduled task (sets status to 'pending').",
  inputSchema: {
    type: "object",
    properties: { task_id: { type: "string" } },
    required: ["task_id"],
  },
};

const RUN_TASK_TOOL: Tool = {
  name: "scheduler_run_task",
  description:
    "Build the execution prompt for a task and spawn a detached `claude --dangerously-skip-permissions -p <prompt>` subprocess. " +
    "Marks the task as 'running'. The spawned session writes back results via scheduler_update_task when done. " +
    "Use this from the scheduler poller CronCreate to execute due tasks without openclaw.",
  inputSchema: {
    type: "object",
    properties: { task_id: { type: "string" } },
    required: ["task_id"],
  },
};

const GET_PROMPT_TOOL: Tool = {
  name: "scheduler_get_prompt",
  description: "Return the execution prompt for a task without running it (for inspection/debugging).",
  inputSchema: {
    type: "object",
    properties: { task_id: { type: "string" } },
    required: ["task_id"],
  },
};

// ── Server ────────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "uwu-code-scheduler-mcp", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    LIST_TASKS_TOOL,
    CREATE_TASK_TOOL,
    GET_TASK_TOOL,
    UPDATE_TASK_TOOL,
    DELETE_TASK_TOOL,
    QUEUE_NOW_TOOL,
    RUN_TASK_TOOL,
    GET_PROMPT_TOOL,
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request: { params: { name: string; arguments?: Record<string, unknown> } }) => {
  const { name, arguments: args } = request.params;

  const ok = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  });

  try {
    switch (name) {
      // ── list ──────────────────────────────────────────────────────────────
      case "scheduler_list_tasks": {
        let tasks = loadTasks();
        if (args?.status) tasks = tasks.filter(t => t.status === args.status);
        if (args?.type)   tasks = tasks.filter(t => t.type   === args.type);
        return ok({ tasks, count: tasks.length });
      }

      // ── create ────────────────────────────────────────────────────────────
      case "scheduler_create_task": {
        if (!args?.description || !args?.type)
          throw new McpError(ErrorCode.InvalidParams, "description and type are required");

        const taskType = args.type as "coding" | "research";
        const mode = (args.schedule_mode as ScheduleMode) || "anytime";
        const now = new Date().toISOString();

        const newTask: Task = {
          id: randomUUID(),
          title: (args.title as string) || (args.description as string).slice(0, 60),
          type: taskType,
          description: args.description as string,
          workspace: taskType === "coding" ? ((args.workspace as string) || "/opt/workspaces") : undefined,
          preferred_tool: taskType === "coding" ? ((args.preferred_tool as "claude" | "opencode" | "auto") || "auto") : undefined,
          status: mode === "manual" ? "manual" : mode === "anytime" ? "pending" : "scheduled",
          schedule_mode: mode,
          schedule_time: args.schedule_time as string | undefined,
          schedule_weekday: args.schedule_weekday as number | undefined,
          scheduled_at: mode === "once" ? (args.one_time_at as string | undefined) : undefined,
          created_at: now,
        };

        const tasks = loadTasks();
        tasks.push(newTask);
        saveTasks(tasks);
        return ok({ success: true, task: newTask });
      }

      // ── get ───────────────────────────────────────────────────────────────
      case "scheduler_get_task": {
        if (!args?.task_id) throw new McpError(ErrorCode.InvalidParams, "task_id is required");
        const task = loadTasks().find(t => t.id === args.task_id);
        return ok(task ? { task } : { error: "Task not found", task_id: args.task_id });
      }

      // ── update ────────────────────────────────────────────────────────────
      case "scheduler_update_task": {
        if (!args?.task_id) throw new McpError(ErrorCode.InvalidParams, "task_id is required");

        const tasks = loadTasks();
        const idx = tasks.findIndex(t => t.id === args.task_id);
        if (idx === -1) return ok({ error: "Task not found", task_id: args.task_id });

        const allowed = [
          "title", "description", "status", "report",
          "schedule_mode", "schedule_time", "schedule_weekday", "scheduled_at",
          "started_at", "completed_at", "last_run_at", "last_run_status",
        ];
        for (const key of allowed) {
          if (args[key] !== undefined) {
            (tasks[idx] as unknown as Record<string, unknown>)[key] = args[key];
          }
        }

        if (args.status === "completed" || args.status === "failed") {
          const sessionName = `uwu-${String(args.task_id).slice(0, 8)}`;
          try {
            execSync(`tmux kill-session -t "${sessionName}" 2>/dev/null || true`, { timeout: 5000 });
          } catch { /* ignore */ }
        }

        saveTasks(tasks);
        return ok({ success: true, task: tasks[idx] });
      }

      // ── delete ────────────────────────────────────────────────────────────
      case "scheduler_delete_task": {
        if (!args?.task_id) throw new McpError(ErrorCode.InvalidParams, "task_id is required");
        const tasks = loadTasks();
        const idx = tasks.findIndex(t => t.id === args.task_id);
        if (idx === -1) return ok({ error: "Task not found", task_id: args.task_id });
        const [deleted] = tasks.splice(idx, 1);
        saveTasks(tasks);
        return ok({ success: true, deleted_task: deleted });
      }

      // ── queue_now ─────────────────────────────────────────────────────────
      case "scheduler_queue_now": {
        if (!args?.task_id) throw new McpError(ErrorCode.InvalidParams, "task_id is required");
        const tasks = loadTasks();
        const idx = tasks.findIndex(t => t.id === args.task_id);
        if (idx === -1) return ok({ error: "Task not found", task_id: args.task_id });
        tasks[idx].status = "pending";
        delete tasks[idx].scheduled_at;
        saveTasks(tasks);
        return ok({ success: true, message: "Task queued", task: tasks[idx] });
      }

      // ── run_task ──────────────────────────────────────────────────────────
      case "scheduler_run_task": {
        if (!args?.task_id) throw new McpError(ErrorCode.InvalidParams, "task_id is required");

        const tasks = loadTasks();
        const idx = tasks.findIndex(t => t.id === args.task_id);
        if (idx === -1) return ok({ error: "Task not found", task_id: args.task_id });

        const task = tasks[idx];
        const prompt = buildExecutionPrompt(task);

        // Spawn detached claude subprocess; it runs from the repo root so it
        // picks up .mcp/config.json and can call scheduler_update_task when done.
        const child = spawn(
          "claude",
          ["--dangerously-skip-permissions", "-p", prompt],
          { cwd: REPO_ROOT, detached: true, stdio: "ignore" }
        );
        child.unref();

        // Mark running immediately
        tasks[idx].status = "running";
        tasks[idx].started_at = new Date().toISOString();
        saveTasks(tasks);

        return ok({
          success: true,
          message: "Task spawned",
          task_id: task.id,
          pid: child.pid,
        });
      }

      // ── get_prompt ────────────────────────────────────────────────────────
      case "scheduler_get_prompt": {
        if (!args?.task_id) throw new McpError(ErrorCode.InvalidParams, "task_id is required");
        const task = loadTasks().find(t => t.id === args.task_id);
        if (!task) return ok({ error: "Task not found", task_id: args.task_id });
        return ok({ task_id: task.id, prompt: buildExecutionPrompt(task) });
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof McpError) throw error;
    throw new McpError(ErrorCode.InternalError, `Tool error: ${error instanceof Error ? error.message : String(error)}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("uwu-code Scheduler MCP server v2 running (openclaw-free)");
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
