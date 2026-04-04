"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PortInfo, TmuxSession, TmuxWindow } from "../page";

interface ExposedPort {
  port: number;
  url: string;
}

interface Props {
  sessions: TmuxSession[];
  ports: PortInfo[];
  loading: boolean;
  onRefresh: () => void;
  onExpose: (port: PortInfo) => void;
  onPortsChanged: () => void;
  refreshToken?: number;
}

function formatAge(created: number): string {
  if (!created) return "";
  const ageMs = Date.now() - created * 1000;
  const ageS = Math.floor(ageMs / 1000);
  if (ageS < 60) return `${ageS}s`;
  const ageM = Math.floor(ageS / 60);
  if (ageM < 60) return `${ageM}m`;
  const ageH = Math.floor(ageM / 60);
  if (ageH < 24) return `${ageH}h`;
  const ageD = Math.floor(ageH / 24);
  return `${ageD}d`;
}

function truncateCwd(cwd: string, maxLen = 40): string {
  if (!cwd) return "";
  if (cwd.length <= maxLen) return cwd;
  // Keep last part of path
  const parts = cwd.split("/");
  let result = "…/" + parts[parts.length - 1];
  for (let i = parts.length - 2; i > 0; i--) {
    const candidate = "…/" + parts.slice(i).join("/");
    if (candidate.length <= maxLen) result = candidate;
    else break;
  }
  return result;
}

function getPortsForSession(
  ports: PortInfo[],
  sessionName: string
): PortInfo[] {
  return ports.filter((p) => p.matchedSession === sessionName);
}

function getPortsForWindow(
  ports: PortInfo[],
  sessionName: string,
  windowName: string
): PortInfo[] {
  return ports.filter(
    (p) => p.matchedSession === sessionName && p.matchedWindow === windowName
  );
}

function WindowRow({
  window,
  sessionName,
  ports,
  exposedPorts,
  onExpose,
  onUnexpose,
  unexposingPort,
}: {
  window: TmuxWindow;
  sessionName: string;
  ports: PortInfo[];
  exposedPorts: Set<number>;
  onExpose: (port: PortInfo) => void;
  onUnexpose: (port: number) => void;
  unexposingPort: number | null;
}) {
  const matchedPorts = getPortsForWindow(ports, sessionName, window.windowName);

  return (
    <div
      className="flex flex-col gap-1 px-3 py-2.5 rounded transition-colors"
      style={{
        background: window.active
          ? "rgba(0, 255, 136, 0.05)"
          : "rgba(30, 45, 74, 0.2)",
        border: `1px solid ${window.active ? "rgba(0, 255, 136, 0.15)" : "rgba(30, 45, 74, 0.4)"}`,
      }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* Window index */}
          <span
            className="text-xs w-5 h-5 flex items-center justify-center rounded flex-shrink-0"
            style={{
              background: window.active
                ? "rgba(0, 255, 136, 0.2)"
                : "rgba(30, 45, 74, 0.6)",
              color: window.active ? "#00ff88" : "#94a3b8",
              fontSize: "0.65rem",
              fontWeight: 700,
            }}
          >
            {window.windowIndex}
          </span>

          {/* Window name */}
          <span
            className="text-sm font-medium truncate"
            style={{ color: window.active ? "#e2e8f0" : "#94a3b8" }}
          >
            {window.windowName}
          </span>

          {/* Active badge */}
          {window.active && (
            <span
              className="badge flex-shrink-0"
              style={{
                background: "rgba(0, 255, 136, 0.1)",
                color: "#00ff88",
                border: "1px solid rgba(0, 255, 136, 0.2)",
              }}
            >
              <span
                className="w-1 h-1 rounded-full pulse-dot"
                style={{ background: "#00ff88" }}
              />
              active
            </span>
          )}
        </div>

        {/* PID */}
        {window.panePid && (
          <span className="text-xs flex-shrink-0 pl-7 sm:pl-0" style={{ color: "#4a5568" }}>
            pid:{window.panePid}
          </span>
        )}
      </div>

      {/* CWD */}
      {window.cwd && (
        <div
          className="flex items-center gap-1.5 text-xs"
          style={{ color: "#94a3b8" }}
          title={window.cwd}
        >
          <svg
            className="w-3 h-3 flex-shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: "#4a5568" }}
          >
            <title>Working directory</title>
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          <span className="font-mono truncate">{truncateCwd(window.cwd)}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1 mt-0.5">
        {matchedPorts.map((p) => (
          <div key={p.port} className="flex items-center gap-1.5">
            <span
              className="badge"
              style={{
                background: "rgba(0, 212, 255, 0.1)",
                color: "#00d4ff",
                border: "1px solid rgba(0, 212, 255, 0.25)",
              }}
            >
              :{p.port}
            </span>
            {exposedPorts.has(p.port) ? (
              <button
                type="button"
                className="px-2 py-0.5 rounded text-[10px] font-semibold"
                onClick={() => onUnexpose(p.port)}
                disabled={unexposingPort === p.port}
                style={{
                  background: "rgba(255,68,68,0.12)",
                  color: unexposingPort === p.port ? "#4a5568" : "#ff6b6b",
                  border: "1px solid rgba(255,68,68,0.3)",
                }}
              >
                {unexposingPort === p.port ? "Stopping…" : "Stop"}
              </button>
            ) : (
              <button
                type="button"
                className="px-2 py-0.5 rounded text-[10px] font-semibold"
                onClick={() => onExpose(p)}
                style={{
                  background: "rgba(0,212,255,0.12)",
                  color: "#00d4ff",
                  border: "1px solid rgba(0,212,255,0.3)",
                }}
              >
                Expose
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SessionCard({
  session,
  ports,
  defaultExpanded,
  onStopped,
  exposedPorts,
  onExpose,
  onUnexpose,
  unexposingPort,
}: {
  session: TmuxSession;
  ports: PortInfo[];
  defaultExpanded: boolean;
  onStopped: () => void;
  exposedPorts: Set<number>;
  onExpose: (port: PortInfo) => void;
  onUnexpose: (port: number) => void;
  unexposingPort: number | null;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [stopping, setStopping] = useState(false);
  const sessionPorts = getPortsForSession(ports, session.name);
  const age = formatAge(session.created);

  const handleStopSession = async () => {
    if (stopping) return;
    const ok = confirm(`Stop tmux session "${session.name}"?`);
    if (!ok) return;
    setStopping(true);
    try {
      const res = await fetch(`/api/sessions?name=${encodeURIComponent(session.name)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error ?? "Failed to stop session");
        return;
      }
      onStopped();
    } catch {
      alert("Network error while stopping session");
    } finally {
      setStopping(false);
    }
  };

  return (
    <div
      className="card card-hover overflow-hidden"
      style={{
        border: sessionPorts.length > 0 ? "1px solid rgba(0, 212, 255, 0.25)" : undefined,
      }}
    >
      {/* Session header */}
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors hover:bg-white/5"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* Collapse indicator */}
          <svg
            className="w-3.5 h-3.5 flex-shrink-0 transition-transform"
            style={{
              color: "#4a5568",
              transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <title>Toggle session details</title>
            <polyline points="9 18 15 12 9 6" />
          </svg>

          {/* Session icon */}
          <div
            className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0"
            style={{
              background: "rgba(0, 255, 136, 0.1)",
              border: "1px solid rgba(0, 255, 136, 0.2)",
            }}
          >
            <svg
              className="w-3.5 h-3.5"
              style={{ color: "#00ff88" }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <title>Session</title>
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>

          {/* Session name */}
          <span
            className="font-semibold text-sm truncate"
            style={{ color: "#e2e8f0" }}
          >
            {session.name}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end flex-shrink-0">
          {/* Port count badge */}
          {sessionPorts.length > 0 && (
            <span
              className="badge"
              style={{
                background: "rgba(0, 212, 255, 0.1)",
                color: "#00d4ff",
                border: "1px solid rgba(0, 212, 255, 0.25)",
              }}
            >
              <svg
                className="w-2.5 h-2.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <title>Ports in session</title>
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              {sessionPorts.length} port{sessionPorts.length !== 1 ? "s" : ""}
            </span>
          )}

          {/* Window count */}
          <span
            className="badge"
            style={{
              background: "rgba(30, 45, 74, 0.6)",
              color: "#94a3b8",
              border: "1px solid rgba(30, 45, 74, 0.8)",
            }}
          >
            {session.windowCount} win
          </span>

          {/* Age */}
          {age && (
            <span className="text-xs" style={{ color: "#4a5568" }}>
              {age}
            </span>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void handleStopSession();
            }}
            disabled={stopping}
            className="px-2 py-0.5 rounded text-xs font-medium"
            style={{
              background: stopping ? "rgba(30,45,74,0.5)" : "rgba(255,68,68,0.12)",
              border: "1px solid rgba(255,68,68,0.3)",
              color: stopping ? "#4a5568" : "#ff4444",
            }}
            title="Stop tmux session"
          >
            {stopping ? "Stopping…" : "Stop"}
          </button>
        </div>
      </button>

      {/* Windows list */}
      {expanded && (
        <div className="px-3 pb-3 space-y-1.5">
          {session.windows.length === 0 ? (
            <div className="text-xs px-2 py-2" style={{ color: "#4a5568" }}>
              No windows
            </div>
          ) : (
            session.windows.map((w) => (
              <WindowRow
                key={w.windowIndex}
                window={w}
                sessionName={session.name}
                ports={ports}
                exposedPorts={exposedPorts}
                onExpose={onExpose}
                onUnexpose={onUnexpose}
                unexposingPort={unexposingPort}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function SessionsPanel({ sessions, ports, loading, onRefresh, onExpose, onPortsChanged, refreshToken }: Props) {
  const [exposedPorts, setExposedPorts] = useState<ExposedPort[]>([]);
  const [unexposingPort, setUnexposingPort] = useState<number | null>(null);

  const exposedSet = useMemo(() => new Set(exposedPorts.map((p) => p.port)), [exposedPorts]);

  const fetchExposedPorts = useCallback(async () => {
    try {
      const res = await fetch("/api/expose");
      const data = await res.json();
      setExposedPorts(data.ports ?? []);
    } catch {
      setExposedPorts([]);
    }
  }, []);

  useEffect(() => {
    void refreshToken;
    void fetchExposedPorts();
  }, [fetchExposedPorts, refreshToken]);

  useEffect(() => {
    const poll = setInterval(() => {
      void fetchExposedPorts();
    }, 10000);
    return () => clearInterval(poll);
  }, [fetchExposedPorts]);

  const handleUnexpose = useCallback(async (port: number) => {
    if (unexposingPort !== null) return;
    const ok = confirm(`Stop exposing port ${port}?`);
    if (!ok) return;
    setUnexposingPort(port);
    try {
      const res = await fetch("/api/expose", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        alert(data.message ?? "Failed to stop exposing port");
        return;
      }
      await fetchExposedPorts();
      onPortsChanged();
    } catch {
      alert("Network error while stopping exposed port");
    } finally {
      setUnexposingPort(null);
    }
  }, [unexposingPort, fetchExposedPorts, onPortsChanged]);

  return (
    <div className="flex flex-col gap-4">
      {/* Panel header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4"
            style={{ color: "#00ff88" }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <title>Tmux sessions</title>
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <h2 className="text-sm font-semibold uppercase tracking-widest" style={{ color: "#00ff88" }}>
            Tmux Sessions
          </h2>
        </div>
        <span
          className="badge"
          style={{
            background: "rgba(0, 255, 136, 0.1)",
            color: "#00ff88",
            border: "1px solid rgba(0, 255, 136, 0.2)",
          }}
        >
          {loading ? "…" : `${sessions.length} sessions`}
        </span>
      </div>

      

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="card animate-pulse"
              style={{ height: 64 }}
            >
              <div className="flex items-center gap-3 px-4 py-3">
                <div
                  className="w-7 h-7 rounded"
                  style={{ background: "#1e2d4a" }}
                />
                <div
                  className="h-4 rounded"
                  style={{ background: "#1e2d4a", width: "40%" }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div
          className="card flex flex-col items-center justify-center py-12 gap-3"
          style={{ color: "#4a5568" }}
        >
          <svg
            className="w-10 h-10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <title>No sessions</title>
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <div className="text-sm">No tmux sessions found</div>
          <div className="text-xs" style={{ color: "#2e4a7a" }}>
            Start a session with{" "}
            <code
              className="px-1.5 py-0.5 rounded"
              style={{ background: "#1e2d4a", color: "#00ff88" }}
            >
              tmux new -s mysession
            </code>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <SessionCard
              key={session.name}
              session={session}
              ports={ports}
              defaultExpanded={false}
              onStopped={onRefresh}
              exposedPorts={exposedSet}
              onExpose={onExpose}
              onUnexpose={handleUnexpose}
              unexposingPort={unexposingPort}
            />
          ))}
        </div>
      )}
    </div>
  );
}
