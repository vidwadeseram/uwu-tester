/**
 * OpenCode Server Manager
 *
 * Manages OpenCode server instances per workspace.
 * Replaces CLI subprocess spawning with the HTTP API exposed by `opencode serve`.
 *
 * Architecture:
 *   - One opencode server per workspace (workspace → port mapping)
 *   - Tasks create sessions within the server
 *   - Messages are sent via HTTP, responses streamed via SSE
 *   - User intervention via permission response API
 */

import { spawn, ChildProcess } from "child_process";
import { randomUUID } from "crypto";

// ── Types ────────────────────────────────────────────────────────────────────

export interface OpenCodeServer {
  id: string;
  workspace: string;
  port: number;
  hostname: string;
  pid: number;
  process: ChildProcess;
  startedAt: string;
  status: "starting" | "ready" | "error" | "stopped";
}

export interface OpenCodeSession {
  id: string;
  title?: string;
  parentID?: string;
  createdAt: string;
}

export interface OpenCodeMessage {
  info: {
    id: string;
    role: "user" | "assistant";
    sessionID: string;
    createdAt: string;
    [key: string]: unknown;
  };
  parts: OpenCodePart[];
}

export interface OpenCodePart {
  id: string;
  type: "text" | "tool-invocation" | "tool-result" | "reasoning" | "source" | "step-start" | "step-finish";
  text?: string;
  name?: string;
  state?: "call" | "partial-call" | "result";
  toolCallID?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  [key: string]: unknown;
}

export interface OpenCodeSessionStatus {
  [sessionID: string]: {
    status: "idle" | "running" | "error";
    currentTool?: string;
    messageCount?: number;
    [key: string]: unknown;
  };
}

export interface OpenCodeEvent {
  type: string;
  data: unknown;
  timestamp?: string;
}

export interface TaskActivity {
  id: string;
  taskId: string;
  sessionId: string;
  serverId: string;
  timestamp: string;
  type: "message_sent" | "message_received" | "tool_call" | "tool_result" | "permission_request" | "error" | "status_change" | "diff";
  content: string;
  metadata?: Record<string, unknown>;
}

// ── Server Registry ──────────────────────────────────────────────────────────

const servers = new Map<string, OpenCodeServer>();
const BASE_PORT = 4100;
const MAX_PORT_ATTEMPTS = 100;
const REPO_ROOT = process.cwd().replace("/dashboard", "");

let nextPort = BASE_PORT;

function getNextPort(): number {
  const port = nextPort;
  nextPort++;
  if (nextPort > BASE_PORT + MAX_PORT_ATTEMPTS) {
    nextPort = BASE_PORT;
  }
  return port;
}

// ── Activity Log ─────────────────────────────────────────────────────────────

const activityLog = new Map<string, TaskActivity[]>();
const MAX_ACTIVITY_PER_TASK = 500;

function logActivity(taskId: string, activity: Omit<TaskActivity, "id" | "timestamp">) {
  const entry: TaskActivity = {
    ...activity,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
  };
  const log = activityLog.get(taskId) || [];
  log.push(entry);
  if (log.length > MAX_ACTIVITY_PER_TASK) {
    log.splice(0, log.length - MAX_ACTIVITY_PER_TASK);
  }
  activityLog.set(taskId, log);
}

export function getActivityLog(taskId: string): TaskActivity[] {
  return activityLog.get(taskId) || [];
}

export function clearActivityLog(taskId: string) {
  activityLog.delete(taskId);
}

// ── Task → Session mapping ───────────────────────────────────────────────────

const taskSessions = new Map<string, { serverId: string; sessionId: string }>();

export function getTaskSession(taskId: string) {
  return taskSessions.get(taskId);
}

export function setTaskSession(taskId: string, serverId: string, sessionId: string) {
  taskSessions.set(taskId, { serverId, sessionId });
}

export function deleteTaskSession(taskId: string) {
  taskSessions.delete(taskId);
}

export function getAllTaskSessions(): Record<string, { serverId: string; sessionId: string }> {
  return Object.fromEntries(taskSessions.entries());
}

// ── Server lifecycle ─────────────────────────────────────────────────────────

export async function getOrCreateServer(workspace: string): Promise<OpenCodeServer> {
  // Reuse existing server for this workspace
  for (const [, server] of servers) {
    if (server.workspace === workspace && server.status !== "stopped" && server.status !== "error") {
      return server;
    }
  }
  return startServer(workspace);
}

export async function startServer(workspace: string): Promise<OpenCodeServer> {
  const id = randomUUID();
  const port = getNextPort();
  const hostname = "127.0.0.1";

  const proc = spawn(
    "opencode",
    ["serve", "--port", String(port), "--hostname", hostname, "--cors", "http://localhost:3000"],
    {
      cwd: workspace,
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // Suppress TUI when running headless
        TERM: "dumb",
      },
    }
  );

  const server: OpenCodeServer = {
    id,
    workspace,
    port,
    hostname,
    pid: proc.pid!,
    process: proc,
    startedAt: new Date().toISOString(),
    status: "starting",
  };

  servers.set(id, server);

  proc.on("error", (err) => {
    console.error(`[opencode-server] Server ${id} error:`, err);
    server.status = "error";
  });

  proc.on("exit", (code) => {
    console.log(`[opencode-server] Server ${id} exited with code ${code}`);
    server.status = "stopped";
  });

  // Capture stderr for debugging
  proc.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.error(`[opencode-server:${id}] ${msg}`);
  });

  // Wait for server to be ready
  const ready = await waitForReady(hostname, port, 30_000);
  if (!ready) {
    server.status = "error";
    throw new Error(`OpenCode server failed to start on port ${port} for workspace ${workspace}`);
  }

  server.status = "ready";
  console.log(`[opencode-server] Server ${id} ready at http://${hostname}:${port} (workspace: ${workspace})`);
  return server;
}

export async function stopServer(serverId: string): Promise<void> {
  const server = servers.get(serverId);
  if (!server) return;

  try {
    server.process.kill("SIGTERM");
    server.status = "stopped";
  } catch {
    // Already dead
  }
  servers.delete(serverId);
}

export function getServer(serverId: string): OpenCodeServer | undefined {
  return servers.get(serverId);
}

export function getAllServers(): OpenCodeServer[] {
  return Array.from(servers.values());
}

export function getServerForWorkspace(workspace: string): OpenCodeServer | undefined {
  for (const [, server] of servers) {
    if (server.workspace === workspace && server.status === "ready") {
      return server;
    }
  }
  return undefined;
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

async function waitForReady(hostname: string, port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://${hostname}:${port}/global/health`);
      if (res.ok) return true;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function serverFetch<T>(server: OpenCodeServer, path: string, init?: RequestInit): Promise<T> {
  const url = `http://${server.hostname}:${server.port}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(init?.headers as Record<string, string> || {}),
  };

  // Add auth if configured
  const password = process.env.OPENCODE_SERVER_PASSWORD;
  if (password) {
    const username = process.env.OPENCODE_SERVER_USERNAME || "opencode";
    headers["Authorization"] = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  }

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenCode server error ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Session API ──────────────────────────────────────────────────────────────

export async function createSession(server: OpenCodeServer, title?: string): Promise<OpenCodeSession> {
  return serverFetch<OpenCodeSession>(server, "/session", {
    method: "POST",
    body: JSON.stringify({ title: title || `Task session` }),
  });
}

export async function listSessions(server: OpenCodeServer): Promise<OpenCodeSession[]> {
  return serverFetch<OpenCodeSession[]>(server, "/session");
}

export async function getSessionStatus(server: OpenCodeServer): Promise<OpenCodeSessionStatus> {
  return serverFetch<OpenCodeSessionStatus>(server, "/session/status");
}

export async function abortSession(server: OpenCodeServer, sessionId: string): Promise<boolean> {
  return serverFetch<boolean>(server, `/session/${sessionId}/abort`, { method: "POST" });
}

export async function deleteSession(server: OpenCodeServer, sessionId: string): Promise<boolean> {
  return serverFetch<boolean>(server, `/session/${sessionId}`, { method: "DELETE" });
}

// ── Message API ──────────────────────────────────────────────────────────────

export async function sendMessage(
  server: OpenCodeServer,
  sessionId: string,
  message: string,
  options?: { agent?: string; model?: string }
): Promise<OpenCodeMessage> {
  return serverFetch<OpenCodeMessage>(server, `/session/${sessionId}/message`, {
    method: "POST",
    body: JSON.stringify({
      parts: [{ type: "text", text: message }],
      ...options,
    }),
  });
}

export async function sendMessageAsync(
  server: OpenCodeServer,
  sessionId: string,
  message: string,
  options?: { agent?: string; model?: string }
): Promise<void> {
  await serverFetch<void>(server, `/session/${sessionId}/prompt_async`, {
    method: "POST",
    body: JSON.stringify({
      parts: [{ type: "text", text: message }],
      ...options,
    }),
  });
}

export async function getMessages(
  server: OpenCodeServer,
  sessionId: string,
  limit?: number
): Promise<OpenCodeMessage[]> {
  const query = limit ? `?limit=${limit}` : "";
  return serverFetch<OpenCodeMessage[]>(server, `/session/${sessionId}/message${query}`);
}

export async function getSessionDiff(
  server: OpenCodeServer,
  sessionId: string,
  messageID?: string
): Promise<unknown[]> {
  const query = messageID ? `?messageID=${messageID}` : "";
  return serverFetch<unknown[]>(server, `/session/${sessionId}/diff${query}`);
}

// ── Permission API (user intervention) ───────────────────────────────────────

export async function respondToPermission(
  server: OpenCodeServer,
  sessionId: string,
  permissionId: string,
  response: "allow" | "deny",
  remember?: boolean
): Promise<boolean> {
  return serverFetch<boolean>(server, `/session/${sessionId}/permissions/${permissionId}`, {
    method: "POST",
    body: JSON.stringify({ response, remember }),
  });
}

// ── High-level task execution ────────────────────────────────────────────────

export interface RunTaskOptions {
  taskId: string;
  title: string;
  description: string;
  workspace: string;
  type: "coding" | "research";
  preferredTool?: "opencode" | "claude" | "auto";
}

export async function runTaskViaServer(opts: RunTaskOptions): Promise<{
  serverId: string;
  sessionId: string;
}> {
  const server = await getOrCreateServer(opts.workspace);
  const session = await createSession(server, opts.title);

  // Track the mapping
  setTaskSession(opts.taskId, server.id, session.id);
  logActivity(opts.taskId, {
    taskId: opts.taskId,
    sessionId: session.id,
    serverId: server.id,
    type: "status_change",
    content: "Session created, sending task prompt",
  });

  // Build the prompt based on task type
  const prompt = buildTaskPrompt(opts);

  // Send message asynchronously (don't wait for completion)
  await sendMessageAsync(server, session.id, prompt);

  logActivity(opts.taskId, {
    taskId: opts.taskId,
    sessionId: session.id,
    serverId: server.id,
    type: "message_sent",
    content: prompt.slice(0, 200),
    metadata: { fullPrompt: prompt },
  });

  return { serverId: server.id, sessionId: session.id };
}

function buildTaskPrompt(opts: RunTaskOptions): string {
  const ws = opts.workspace || "/opt/workspaces";

  if (opts.type === "coding") {
    return (
      `Execute this scheduled coding task: ${opts.title}\n\n` +
      `Description: ${opts.description}\n` +
      `Target workspace: ${ws}\n\n` +
      `Use your tools (Bash, Edit, Write, etc.) to complete this task fully in the target workspace.\n\n` +
      `When done, call scheduler_update_task MCP tool: task_id="${opts.taskId}", ` +
      `status="completed" or "failed", report=<summary>, ` +
      `completed_at=<ISO timestamp>, last_run_at=<ISO timestamp>, last_run_status="completed" or "failed".`
    );
  }

  return (
    `You are executing scheduled research task "${opts.title}".\n\n` +
    `Task: ${opts.description}\n\n` +
    `Research and answer this thoroughly. Use WebSearch or WebFetch if helpful.\n\n` +
    `When done, call scheduler_update_task MCP tool: task_id="${opts.taskId}", ` +
    `status="completed" or "failed", report=<findings>, ` +
    `completed_at=<ISO timestamp>, last_run_at=<ISO timestamp>, last_run_status="completed" or "failed".`
  );
}

// ── Activity polling (for dashboard) ─────────────────────────────────────────

export interface TaskStatus {
  serverId: string;
  sessionId: string;
  sessionStatus: "idle" | "running" | "error";
  messageCount: number;
  lastActivity: string;
  activity: TaskActivity[];
  currentTool?: string;
}

export async function getTaskStatus(taskId: string): Promise<TaskStatus | null> {
  const mapping = taskSessions.get(taskId);
  if (!mapping) return null;

  const server = servers.get(mapping.serverId);
  if (!server || server.status !== "ready") {
    return {
      ...mapping,
      sessionStatus: "error",
      messageCount: 0,
      lastActivity: "",
      activity: getActivityLog(taskId),
    };
  }

  try {
    const statuses = await getSessionStatus(server);
    const sessionStatus = statuses[mapping.sessionId];

    // Fetch recent messages and convert to activity
    const messages = await getMessages(server, mapping.sessionId, 20);
    for (const msg of messages) {
      for (const part of msg.parts || []) {
        const existingLog = getActivityLog(taskId);
        const alreadyLogged = existingLog.some(
          (a) => a.metadata?.partId === part.id && a.metadata?.messageId === msg.info.id
        );
        if (!alreadyLogged) {
          if (part.type === "tool-invocation" && part.state === "call") {
            logActivity(taskId, {
              taskId,
              sessionId: mapping.sessionId,
              serverId: mapping.serverId,
              type: "tool_call",
              content: `${part.name || "tool"}(${formatArgs(part.args)})`,
              metadata: { partId: part.id, messageId: msg.info.id, toolName: part.name, args: part.args },
            });
          } else if (part.type === "tool-result") {
            logActivity(taskId, {
              taskId,
              sessionId: mapping.sessionId,
              serverId: mapping.serverId,
              type: "tool_result",
              content: formatResult(part.result),
              metadata: { partId: part.id, messageId: msg.info.id },
            });
          } else if (part.type === "text" && part.text && msg.info.role === "assistant") {
            logActivity(taskId, {
              taskId,
              sessionId: mapping.sessionId,
              serverId: mapping.serverId,
              type: "message_received",
              content: part.text.slice(0, 200),
              metadata: { partId: part.id, messageId: msg.info.id },
            });
          }
        }
      }
    }

    return {
      ...mapping,
      sessionStatus: sessionStatus?.status || "idle",
      messageCount: messages.length,
      lastActivity: new Date().toISOString(),
      activity: getActivityLog(taskId),
      currentTool: sessionStatus?.currentTool,
    };
  } catch (err) {
    return {
      ...mapping,
      sessionStatus: "error",
      messageCount: 0,
      lastActivity: "",
      activity: getActivityLog(taskId),
    };
  }
}

// ── User intervention ────────────────────────────────────────────────────────

export async function sendUserMessage(taskId: string, message: string): Promise<boolean> {
  const mapping = taskSessions.get(taskId);
  if (!mapping) throw new Error("No session found for task");

  const server = servers.get(mapping.serverId);
  if (!server || server.status !== "ready") throw new Error("Server not available");

  logActivity(taskId, {
    taskId,
    sessionId: mapping.sessionId,
    serverId: mapping.serverId,
    type: "message_sent",
    content: `[User intervention] ${message}`,
  });

  await sendMessageAsync(server, mapping.sessionId, message);
  return true;
}

export async function abortTask(taskId: string): Promise<boolean> {
  const mapping = taskSessions.get(taskId);
  if (!mapping) throw new Error("No session found for task");

  const server = servers.get(mapping.serverId);
  if (!server || server.status !== "ready") throw new Error("Server not available");

  logActivity(taskId, {
    taskId,
    sessionId: mapping.sessionId,
    serverId: mapping.serverId,
    type: "status_change",
    content: "Task aborted by user",
  });

  return abortSession(server, mapping.sessionId);
}

export async function getTaskDiff(taskId: string): Promise<unknown[]> {
  const mapping = taskSessions.get(taskId);
  if (!mapping) return [];

  const server = servers.get(mapping.serverId);
  if (!server || server.status !== "ready") return [];

  return getSessionDiff(server, mapping.sessionId);
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function formatArgs(args?: Record<string, unknown>): string {
  if (!args) return "";
  try {
    const str = JSON.stringify(args);
    return str.length > 100 ? str.slice(0, 100) + "..." : str;
  } catch {
    return String(args);
  }
}

function formatResult(result: unknown): string {
  if (!result) return "";
  try {
    const str = typeof result === "string" ? result : JSON.stringify(result);
    return str.length > 200 ? str.slice(0, 200) + "..." : str;
  } catch {
    return String(result);
  }
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

export function cleanup() {
  for (const [id, server] of servers) {
    try {
      server.process.kill("SIGTERM");
    } catch {
      // Already dead
    }
    servers.delete(id);
  }
  activityLog.clear();
  taskSessions.clear();
}

process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);
