import { spawn } from "child_process";

const BASE_PORT = 7682;
const MAX_SESSIONS = 10;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export interface TerminalSession {
  id: string;
  port: number;
  pid: number;
  createdAt: number;
  lastActivity: number;
}

export const sessions = new Map<string, TerminalSession>();

export function findAvailablePort(startPort: number): number {
  let port = startPort;
  const usedPorts = new Set(Array.from(sessions.values()).map((s) => s.port));
  while (usedPorts.has(port) && port < startPort + 100) {
    port++;
  }
  return port;
}

export function killSessionProcess(session: TerminalSession) {
  try {
    process.kill(session.pid, "SIGTERM");
  } catch {
    try {
      process.kill(session.pid, "SIGKILL");
    } catch {}
  }
}

export function cleanupIdleSessions() {
  const now = Date.now();
  const toDelete: string[] = [];
  sessions.forEach((session, id) => {
    if (now - session.lastActivity > IDLE_TIMEOUT_MS) {
      toDelete.push(id);
    }
  });
  toDelete.forEach((id) => {
    const session = sessions.get(id);
    if (session) {
      killSessionProcess(session);
      sessions.delete(id);
    }
  });
}

let cleanupInterval: NodeJS.Timeout | null = null;

export function startSessionCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(cleanupIdleSessions, 60 * 1000);
}

export function createTtydSession(id: string, port: number): TerminalSession {
  const ttydBin = process.env.TTYD_BIN || "/usr/local/bin/ttyd";
  const workingDir = process.env.TERMINAL_WORKDIR || "/opt/workspaces";

  const child = spawn(ttydBin, ["-p", String(port), "-w", "/bin/bash", "-l"], {
    cwd: workingDir,
    stdio: "ignore",
    detached: true,
  });
  const pid = child.pid!;
  child.unref();

  return {
    id,
    port,
    pid,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
}

export { MAX_SESSIONS };
