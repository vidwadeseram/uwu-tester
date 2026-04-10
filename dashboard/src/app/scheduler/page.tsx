"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import IssuesPanel from "@/app/components/IssuesPanel";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Task {
  id: string;
  title: string;
  type: "coding" | "research";
  description: string;
  workspace?: string;
  preferred_tool?: "opencode" | "auto";
  status: "pending" | "running" | "completed" | "failed" | "scheduled" | "manual" | "rate_limited";
  schedule_mode?: "anytime" | "once" | "daily" | "weekly" | "manual";
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
}

interface AgentStatus {
  state: "idle" | "running" | "stopped" | "error";
  current_task_id?: string | null;
  message?: string;
  updated_at?: string | null;
}

interface WorkspaceOption {
  name: string;
  path: string;
  kind: "group" | "project";
}

// Live activity item for opencode status feed
interface ActivityItem {
  id: string;
  taskId: string;
  sessionId?: string;
  serverId?: string;
  timestamp: string;
  type:
    | "tool_call"
    | "tool_result"
    | "message_sent"
    | "message_received"
    | "permission_request"
    | "error"
    | "status_change"
    | "diff";
  content: string;
  metadata?: any;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

const STATUS_COLOR: Record<string, string> = {
  pending:      "#ffd700",
  running:      "#00d4ff",
  completed:    "#00ff88",
  failed:       "#ff4444",
  scheduled:    "#a855f7",
  manual:       "#f97316",
  rate_limited: "#fb923c",
};

const STATUS_BG: Record<string, string> = {
  pending:      "rgba(255,215,0,0.1)",
  running:      "rgba(0,212,255,0.1)",
  completed:    "rgba(0,255,136,0.1)",
  failed:       "rgba(255,68,68,0.1)",
  scheduled:    "rgba(168,85,247,0.1)",
  manual:       "rgba(249,115,22,0.1)",
  rate_limited: "rgba(251,146,60,0.1)",
};

const AGENT_STATE_COLOR: Record<string, string> = {
  idle:    "#00ff88",
  running: "#00d4ff",
  stopped: "#4a5568",
  error:   "#ff4444",
};

const WEEK_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function scheduleLabel(task: Task): string {
  const mode = task.schedule_mode ?? "anytime";
  if (mode === "daily") {
    return task.schedule_time ? `daily at ${task.schedule_time} UTC` : "daily";
  }
  if (mode === "weekly") {
    const day = typeof task.schedule_weekday === "number" && WEEK_DAYS[task.schedule_weekday]
      ? WEEK_DAYS[task.schedule_weekday]
      : "weekly";
    return task.schedule_time ? `${day} ${task.schedule_time} UTC` : `${day}`;
  }
  if (mode === "once") return "one-time";
  if (mode === "manual") return "manual";
  return "queue now";
}

// ── Report Modal ──────────────────────────────────────────────────────────────

function ReportModal({ task, onClose }: { task: Task; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-lg overflow-hidden"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="text-xs px-2 py-0.5 rounded font-semibold uppercase tracking-wider flex-shrink-0"
              style={{
                background: STATUS_BG[task.status],
                color: STATUS_COLOR[task.status],
                border: `1px solid ${STATUS_COLOR[task.status]}40`,
              }}
            >
              {task.status.replace("_", " ")}
            </span>
            <span className="font-semibold text-sm truncate" style={{ color: "var(--text)" }}>
              {task.title}
            </span>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="text-xs px-2 py-1 rounded ml-3 flex-shrink-0"
            style={{ background: "var(--surface)", color: "var(--dim)", border: "1px solid var(--border)" }}
          >
            ✕ Close
          </button>
        </div>

        {/* Meta */}
        <div
          className="flex flex-wrap gap-4 px-5 py-3 text-xs border-b flex-shrink-0"
          style={{ borderColor: "var(--border)", color: "var(--dim)" }}
        >
          <span>Type: <span style={{ color: task.type === "coding" ? "#00d4ff" : "#a855f7" }}>{task.type}</span></span>
          {task.workspace && <span>Workspace: <span style={{ color: "var(--text)" }} className="font-mono">{task.workspace}</span></span>}
          {task.preferred_tool && <span>Tool: <span style={{ color: "#ffd700" }}>{task.preferred_tool}</span></span>}
          <span>Created: {fmtDate(task.created_at)}</span>
          {task.started_at && <span>Started: {fmtDate(task.started_at)}</span>}
          {task.completed_at && <span>Completed: {fmtDate(task.completed_at)}</span>}
        </div>

        {/* Task description */}
        <div className="px-5 py-3 border-b flex-shrink-0" style={{ borderColor: "var(--border)" }}>
          <div className="text-xs mb-1" style={{ color: "#4a5568" }}>Task</div>
          <div className="text-sm" style={{ color: "var(--dim)" }}>{task.description}</div>
        </div>

        {/* Report */}
        <div className="flex-1 overflow-auto px-5 py-4">
          {task.report ? (
            <pre
              className="text-xs leading-relaxed whitespace-pre-wrap font-mono"
              style={{ color: "var(--text)" }}
            >
              {task.report}
            </pre>
          ) : (
            <div className="text-sm text-center py-12" style={{ color: "#4a5568" }}>
              No report yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Task Card ─────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onEdit,
  onDelete,
  onViewReport,
  onQueueNow,
}: {
  task: Task;
  onEdit: () => void;
  onDelete: () => void;
  onViewReport: () => void;
  onQueueNow: () => void;
}) {
  const color = STATUS_COLOR[task.status] ?? "var(--dim)";
  const bg    = STATUS_BG[task.status]    ?? "var(--hover-bg)";
  const isActive = ["pending", "running", "scheduled", "rate_limited"].includes(task.status);

  // Live activity UI state for running tasks
  const [liveOpen, setLiveOpen] = useState(false);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const activityContainerRef = useRef<HTMLDivElement>(null);
  const [liveMessage, setLiveMessage] = useState("");

  async function abortTask() {
    try {
      await fetch("/api/opencode/abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id }),
      });
    } catch {
      // ignore
    }
  }

  async function sendMessage() {
    const m = liveMessage.trim();
    if (!m) return;
    try {
      await fetch("/api/opencode/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, message: m }),
      });
      setLiveMessage("");
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!liveOpen || task.status !== "running") return;
    let active = true;
    const poll = async () => {
      if (!active) return;
      try {
        const res = await fetch(`/api/opencode/status?taskId=${encodeURIComponent(task.id)}`);
        if (res.ok) {
          const data = await res.json();
          if (active) setActivity(data.activity ?? []);
        }
      } catch { /* ignore */ }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => { active = false; clearInterval(interval); };
  }, [liveOpen, task.status, task.id]);

  useEffect(() => {
    if (!activityContainerRef.current) return;
    activityContainerRef.current.scrollTop = activityContainerRef.current.scrollHeight;
  }, [activity]);

  function activityIcon(type: ActivityItem["type"]): { icon: string; color: string } {
    switch (type) {
      case "tool_call":     return { icon: "⚙", color: "#00d4ff" };
      case "tool_result":   return { icon: "✓", color: "#00ff88" };
      case "message_sent":  return { icon: "↑", color: "#ffd700" };
      case "message_received": return { icon: "↓", color: "#a855f7" };
      case "permission_request": return { icon: "🔒", color: "#f97316" };
      case "error":         return { icon: "✗", color: "#ff4444" };
      case "status_change": return { icon: "●", color: "#4a5568" };
      case "diff":          return { icon: "±", color: "#00ff88" };
      default:              return { icon: "·", color: "#4a5568" };
    }
  }

  return (
    <div
      className="card p-4 flex flex-col gap-2 transition-colors"
      style={{ border: `1px solid ${color}30` }}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {/* Animated dot for running */}
          {task.status === "running" ? (
            <span className="w-2 h-2 rounded-full pulse-dot flex-shrink-0" style={{ background: color }} />
          ) : (
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
          )}
          <span className="font-semibold text-sm truncate" style={{ color: "var(--text)" }}>
            {task.title}
          </span>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Status badge */}
          <span
            className="text-xs px-2 py-0.5 rounded font-medium uppercase tracking-wider"
            style={{ background: bg, color, border: `1px solid ${color}40` }}
          >
            {task.status.replace("_", " ")}
          </span>
          {/* Type badge */}
          <span
            className="text-xs px-2 py-0.5 rounded"
            style={{
              background: task.type === "coding" ? "rgba(0,212,255,0.1)" : "rgba(168,85,247,0.1)",
              color: task.type === "coding" ? "#00d4ff" : "#a855f7",
              border: `1px solid ${task.type === "coding" ? "rgba(0,212,255,0.2)" : "rgba(168,85,247,0.2)"}`,
            }}
          >
            {task.type}
          </span>
        </div>
      </div>

      {/* Description preview */}
      <div className="text-xs leading-relaxed line-clamp-2" style={{ color: "var(--dim)" }}>
        {task.description}
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: "#4a5568" }}>
        {task.workspace && (
          <span className="font-mono truncate max-w-48" style={{ color: "var(--dim)" }}>
            📁 {task.workspace.split("/").slice(-2).join("/")}
          </span>
        )}
        {task.preferred_tool && task.preferred_tool !== "auto" && (
          <span style={{ color: "#ffd700" }}>{task.preferred_tool}</span>
        )}
        <span style={{ color: "#f59e0b" }}>{scheduleLabel(task)}</span>
        <span>{timeAgo(task.created_at)}</span>
        {task.status === "scheduled" && task.scheduled_at && (
          <span style={{ color: "#a855f7" }}>next run {fmtDate(task.scheduled_at)}</span>
        )}
        {task.status === "rate_limited" && task.retry_at && (
          <span style={{ color: "#fb923c" }}>⏳ retry {fmtDate(task.retry_at)}</span>
        )}
        {task.status === "manual" && task.last_run_at && (
          <span style={{ color: task.last_run_status === "failed" ? "#ff4444" : "#00ff88" }}>
            last run {timeAgo(task.last_run_at)}
          </span>
        )}
        {task.started_at && !task.completed_at && (
          <span style={{ color: "#00d4ff" }}>started {timeAgo(task.started_at)}</span>
        )}
        {task.completed_at && task.started_at && (
          <span>
            took{" "}
            {Math.round(
              (new Date(task.completed_at).getTime() - new Date(task.started_at).getTime()) / 1000
            )}s
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 pt-1">
        {task.status === "running" && (
          <button
            onClick={() => setLiveOpen((v) => !v)}
            type="button"
            className="text-xs px-2.5 py-1 rounded transition-opacity hover:opacity-80 flex items-center gap-1"
            style={{
              background: liveOpen ? "rgba(0,212,255,0.18)" : "rgba(0,212,255,0.08)",
              color: "#00d4ff",
              border: "1px solid rgba(0,212,255,0.25)",
            }}
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <title>Live</title>
              <circle cx="12" cy="12" r="2" /><path d="M16.24 7.76a6 6 0 010 8.49m-8.48-.01a6 6 0 010-8.49m11.31-2.82a10 10 0 010 14.14m-14.14 0a10 10 0 010-14.14" />
            </svg>
            {liveOpen ? "Hide Live" : "Live"}
          </button>
        )}
        {!isActive && (
          <button
            onClick={onViewReport}
            type="button"
            className="text-xs px-2.5 py-1 rounded transition-opacity hover:opacity-80"
            style={{
              background: "rgba(0,212,255,0.1)",
              color: "#00d4ff",
              border: "1px solid rgba(0,212,255,0.25)",
            }}
          >
            View Report
          </button>
        )}
        {["failed", "scheduled", "manual", "completed", "rate_limited"].includes(task.status) && (
          <button
            onClick={onQueueNow}
            type="button"
            className="text-xs px-2.5 py-1 rounded transition-opacity hover:opacity-80"
            style={{
              background: "rgba(255,215,0,0.08)",
              color: "#ffd700",
              border: "1px solid rgba(255,215,0,0.2)",
            }}
          >
            {task.status === "manual" ? "Add to Queue" : task.status === "rate_limited" ? "Force Retry" : "Queue Now"}
          </button>
        )}
        {!["running"].includes(task.status) && (
          <button
            onClick={onEdit}
            type="button"
            className="text-xs px-2.5 py-1 rounded transition-opacity hover:opacity-80"
            style={{
              background: "rgba(168,85,247,0.08)",
              color: "#a855f7",
              border: "1px solid rgba(168,85,247,0.2)",
            }}
          >
            Edit
          </button>
        )}
        <button
          onClick={onDelete}
          type="button"
          className="text-xs px-2.5 py-1 rounded transition-opacity hover:opacity-80 ml-auto"
          style={{
            background: "rgba(255,68,68,0.08)",
            color: "#ff4444",
            border: "1px solid rgba(255,68,68,0.2)",
          }}
        >
          Delete
        </button>
      </div>

      {task.status === "running" && liveOpen && (
        <div
          className="flex flex-col gap-2 mt-2 rounded-lg overflow-hidden"
          style={{ background: "var(--surface)", border: "1px solid rgba(0,212,255,0.15)" }}
        >
          <div
            ref={activityContainerRef}
            className="overflow-y-auto px-3 py-2 space-y-1"
            style={{ maxHeight: "280px", minHeight: "80px" }}
          >
            {activity.length === 0 ? (
              <div className="text-xs text-center py-6" style={{ color: "#4a5568" }}>
                Waiting for activity…
              </div>
            ) : (
              activity.map((item) => {
                const { icon, color } = activityIcon(item.type);
                return (
                  <div
                    key={item.id}
                    className="flex items-start gap-2 text-xs py-1"
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}
                  >
                    <span
                      className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5"
                      style={{ background: `${color}18`, color, border: `1px solid ${color}30` }}
                    >
                      {icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-mono truncate" style={{ color: "var(--text)" }}>
                        {item.content}
                      </div>
                      <div className="mt-0.5" style={{ color: "#4a5568", fontSize: "0.65rem" }}>
                        {timeAgo(item.timestamp)}
                        {item.type === "tool_call" && item.metadata?.toolName && (
                          <span style={{ color: "#00d4ff", marginLeft: "6px" }}>
                            {String(item.metadata.toolName)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div
            className="flex items-center gap-2 px-3 py-2 border-t"
            style={{ borderColor: "rgba(0,212,255,0.1)" }}
          >
            <input
              type="text"
              value={liveMessage}
              onChange={(e) => setLiveMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendMessage(); } }}
              placeholder="Send message to session…"
              className="flex-1 text-xs px-3 py-1.5 rounded"
              style={{
                background: "var(--input-bg)",
                border: "1px solid var(--input-border)",
                color: "var(--text)",
                outline: "none",
              }}
            />
            <button
              onClick={sendMessage}
              type="button"
              className="text-xs px-3 py-1.5 rounded font-medium transition-opacity hover:opacity-80"
              style={{
                background: "rgba(0,255,136,0.12)",
                color: "#00ff88",
                border: "1px solid rgba(0,255,136,0.25)",
              }}
            >
              Send
            </button>
            <button
              onClick={abortTask}
              type="button"
              className="text-xs px-3 py-1.5 rounded font-medium transition-opacity hover:opacity-80"
              style={{
                background: "rgba(255,68,68,0.1)",
                color: "#ff4444",
                border: "1px solid rgba(255,68,68,0.2)",
              }}
            >
              Abort
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── New Task Form ─────────────────────────────────────────────────────────────

const INPUT = {
  background: "var(--input-bg)",
  border: "1px solid var(--input-border)",
  color: "var(--text)",
  borderRadius: "6px",
  padding: "8px 12px",
  fontSize: "0.8rem",
  outline: "none",
  width: "100%",
};

const SELECT = { ...INPUT };

function NewTaskForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const type = "coding" as const;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scheduleMode, setScheduleMode] = useState<"anytime" | "once" | "daily" | "weekly" | "manual">("anytime");
  const [oneTimeAt, setOneTimeAt] = useState(() => {
    const d = new Date(Date.now() + 5 * 60 * 1000);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hour = String(d.getHours()).padStart(2, "0");
    const minute = String(d.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hour}:${minute}`;
  });
  const [dailyTime, setDailyTime] = useState("09:00");
  const [weeklyDay, setWeeklyDay] = useState(() => new Date().getDay());
  const [weeklyTime, setWeeklyTime] = useState("09:00");
  const [workspace, setWorkspace] = useState("/opt/workspaces");
  const [useWorktree, setUseWorktree] = useState(false);
  const [worktrees, setWorktrees] = useState<Array<{ id: string; name: string; path: string; branch: string; isOnDisk: boolean }>>([]);
  const [selectedWorktreeId, setSelectedWorktreeId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState("");
  const [pickerSearch, setPickerSearch] = useState("");
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceOption[]>([]);

  async function loadWorktrees() {
    try {
      const res = await fetch("/api/worktrees");
      const data = await res.json();
      setWorktrees(data.worktrees ?? []);
    } catch {
      // ignore
    }
  }

  async function loadWorkspaceOptions() {
    setPickerLoading(true);
    setPickerError("");
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) {
        setPickerError("Failed to load folders");
        return;
      }

      const data = await res.json() as {
        projects?: Array<{ name?: string; path?: string }>;
      };

      const options: WorkspaceOption[] = [];
      for (const project of data.projects ?? []) {
        if (!project.path) continue;
        options.push({
          name: project.name || project.path,
          path: project.path,
          kind: "project" as const,
        });
      }

      if (options.length === 0) {
        options.push({ name: "workspaces", path: "/opt/workspaces", kind: "group" });
      }

      const seen = new Set<string>();
      const unique = options.filter((opt) => {
        if (seen.has(opt.path)) return false;
        seen.add(opt.path);
        return true;
      });

      unique.sort((a, b) => a.name.localeCompare(b.name));
      setWorkspaceOptions(unique);
    } catch {
      setPickerError("Failed to load folders");
    } finally {
      setPickerLoading(false);
    }
  }

  async function openPicker() {
    setPickerOpen(true);
    if (workspaceOptions.length === 0 && !pickerLoading) {
      await loadWorkspaceOptions();
    }
  }

  function nextDailyIso(time: string): string {
    const [hour, minute] = time.split(":").map(Number);
    const now = new Date();
    const candidate = new Date();
    candidate.setHours(hour, minute, 0, 0);
    if (candidate.getTime() <= now.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.toISOString();
  }

  function nextWeeklyIso(day: number, time: string): string {
    const [hour, minute] = time.split(":").map(Number);
    const now = new Date();
    const candidate = new Date();
    const delta = (day - candidate.getDay() + 7) % 7;
    candidate.setDate(candidate.getDate() + delta);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate.getTime() <= now.getTime()) {
      candidate.setDate(candidate.getDate() + 7);
    }
    return candidate.toISOString();
  }

  async function submit() {
    if (!description.trim()) { setError("Description is required"); return; }

    const toUtcTime = (date: Date) => {
      const hh = String(date.getUTCHours()).padStart(2, "0");
      const mm = String(date.getUTCMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    };

    const payload: Record<string, unknown> = {
      title: title.trim() || undefined,
      type,
      description: description.trim(),
      workspace: type === "coding" ? workspace : undefined,
      preferred_tool: type === "coding" ? "opencode" : undefined,
      schedule_mode: scheduleMode,
    };

    if (scheduleMode === "once") {
      const oneTimeDate = new Date(oneTimeAt);
      if (Number.isNaN(oneTimeDate.getTime())) {
        setError("Choose a valid one-time run date");
        return;
      }
      const iso = oneTimeDate.toISOString();
      payload.one_time_at = iso;
      payload.scheduled_at = iso;
    }

    if (scheduleMode === "daily") {
      if (!dailyTime) {
        setError("Choose a daily run time");
        return;
      }
      const nextIso = nextDailyIso(dailyTime);
      const nextDate = new Date(nextIso);
      payload.schedule_time = toUtcTime(nextDate);
      payload.scheduled_at = nextIso;
    }

    if (scheduleMode === "weekly") {
      if (!weeklyTime) {
        setError("Choose a weekly run time");
        return;
      }
      const nextIso = nextWeeklyIso(weeklyDay, weeklyTime);
      const nextDate = new Date(nextIso);
      payload.schedule_time = toUtcTime(nextDate);
      payload.schedule_weekday = nextDate.getUTCDay();
      payload.scheduled_at = nextIso;
    }

    setLoading(true); setError("");
    try {
      const res = await fetch("/api/scheduler/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error ?? "Failed"); return; }
      onCreated();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="card p-5 flex flex-col gap-4"
      style={{ border: "1px solid rgba(0,255,136,0.2)" }}
    >
      <div className="text-sm font-semibold" style={{ color: "#00ff88" }}>New Task</div>

      <div className="flex flex-col gap-1">
        <label className="text-xs" htmlFor="schedule-mode" style={{ color: "#4a5568" }}>Schedule</label>
        <div id="schedule-mode" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {([
            { key: "anytime", label: "Queue Now" },
            { key: "once", label: "One-Time" },
            { key: "daily", label: "Daily" },
            { key: "weekly", label: "Weekly" },
            { key: "manual", label: "Manual" },
          ] as const).map((mode) => (
            <button
              key={mode.key}
              type="button"
              onClick={() => setScheduleMode(mode.key)}
              className="py-2 rounded text-xs font-medium transition-all"
              style={{
                background: scheduleMode === mode.key ? "rgba(249,115,22,0.15)" : "var(--hover-bg)",
                color: scheduleMode === mode.key ? "#f59e0b" : "var(--dim)",
                border: `1px solid ${scheduleMode === mode.key ? "rgba(249,115,22,0.4)" : "var(--btn-bg)"}`,
              }}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      {scheduleMode === "once" && (
        <div className="flex flex-col gap-1">
          <label className="text-xs" htmlFor="once-at" style={{ color: "#4a5568" }}>Run at (local time)</label>
          <input
            id="once-at"
            type="datetime-local"
            style={INPUT}
            value={oneTimeAt}
            onChange={(e) => setOneTimeAt(e.target.value)}
          />
        </div>
      )}

      {scheduleMode === "daily" && (
        <div className="flex flex-col gap-1">
          <label className="text-xs" htmlFor="daily-time" style={{ color: "#4a5568" }}>Daily time (local)</label>
          <input
            id="daily-time"
            type="time"
            style={INPUT}
            value={dailyTime}
            onChange={(e) => setDailyTime(e.target.value)}
          />
        </div>
      )}

      {scheduleMode === "weekly" && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs" htmlFor="weekly-day" style={{ color: "#4a5568" }}>Day</label>
            <select
              id="weekly-day"
              style={{ ...SELECT, width: "100%" }}
              value={weeklyDay}
              onChange={(e) => setWeeklyDay(Number(e.target.value))}
            >
              {WEEK_DAYS.map((day, idx) => <option key={day} value={idx}>{day}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" htmlFor="weekly-time" style={{ color: "#4a5568" }}>Time</label>
            <input
              id="weekly-time"
              type="time"
              style={{ ...INPUT, width: "100%" }}
              value={weeklyTime}
              onChange={(e) => setWeeklyTime(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Title */}
      <div className="flex flex-col gap-1">
        <label className="text-xs" htmlFor="task-title" style={{ color: "#4a5568" }}>Title (optional)</label>
        <input
          id="task-title"
          style={INPUT}
          placeholder="Short label…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      {/* Workspace + Tool (coding only) */}
      {type === "coding" && (
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="flex flex-col gap-1 flex-1">
            <div className="flex items-center justify-between">
              <div className="text-xs" style={{ color: "#4a5568" }}>Workspace</div>
              <button
                type="button"
                onClick={() => {
                  setUseWorktree((v) => {
                    if (!v) loadWorktrees();
                    return !v;
                  });
                  setSelectedWorktreeId("");
                }}
                className="text-xs px-2 py-0.5 rounded transition-colors"
                style={{
                  background: useWorktree ? "rgba(168,85,247,0.12)" : "var(--hover-bg)",
                  color: useWorktree ? "#a855f7" : "#4a5568",
                  border: `1px solid ${useWorktree ? "rgba(168,85,247,0.3)" : "var(--btn-bg)"}`,
                }}
              >
                {useWorktree ? "⎇ Worktree" : "Use Worktree"}
              </button>
            </div>
            {useWorktree ? (
              <select
                style={{ ...SELECT, width: "100%" }}
                value={selectedWorktreeId}
                onChange={(e) => {
                  setSelectedWorktreeId(e.target.value);
                  const wt = worktrees.find((w) => w.id === e.target.value);
                  if (wt) setWorkspace(wt.path);
                }}
              >
                <option value="">Select worktree…</option>
                {worktrees.map((wt) => (
                  <option key={wt.id} value={wt.id}>
                    {wt.name} ({wt.branch}){wt.isOnDisk ? "" : " — not on disk"}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={openPicker}
                  className="px-3 py-2 rounded text-xs font-medium sm:w-auto w-full"
                  style={{
                    background: "rgba(0,212,255,0.12)",
                    color: "#00d4ff",
                    border: "1px solid rgba(0,212,255,0.3)",
                  }}
                >
                  Select Folder
                </button>
                <div
                  className="px-3 py-2 rounded text-xs flex-1 font-mono"
                  style={{
                    background: "var(--input-bg)",
                    border: "1px solid var(--input-border)",
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={workspace}
                >
                  {workspace}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Description */}
      <div className="flex flex-col gap-1">
        <label className="text-xs" htmlFor="description" style={{ color: "#4a5568" }}>What should be done?</label>
        <textarea
          id="description"
          style={{ ...INPUT, minHeight: "100px", resize: "vertical" }}
          placeholder="Describe the coding task in detail. The scheduler passes this prompt directly to OpenCode."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      {error && (
        <div className="text-xs px-3 py-2 rounded" style={{ background: "rgba(255,68,68,0.1)", color: "#ff4444", border: "1px solid rgba(255,68,68,0.2)" }}>
          {error}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <button
          onClick={submit}
          type="button"
          disabled={loading}
          className="flex-1 py-2 rounded text-sm font-semibold transition-opacity"
          style={{
            background: loading ? "var(--btn-bg)" : "rgba(0,255,136,0.15)",
            color: loading ? "#4a5568" : "#00ff88",
            border: "1px solid rgba(0,255,136,0.3)",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? (
            <span className="flex items-center justify-center">
              <span className="spinner w-4 h-4 inline-block" style={{ border: "2px solid rgba(0,255,136,0.2)", borderTopColor: "#00ff88" }} />
            </span>
          ) : scheduleMode === "anytime" ? "Queue Task" : scheduleMode === "manual" ? "Create Manual Task" : "Schedule Task"}
        </button>
        <button
          onClick={onCancel}
          type="button"
          className="px-4 py-2 rounded text-sm transition-opacity hover:opacity-70"
          style={{ background: "var(--btn-bg)", color: "var(--dim)", border: "1px solid var(--input-border)" }}
        >
          Cancel
        </button>
      </div>

      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPickerOpen(false);
          }}
        >
          <div
            className="w-full max-w-2xl max-h-[75vh] flex flex-col rounded-lg overflow-hidden"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
              <div className="text-sm font-semibold" style={{ color: "#00d4ff" }}>Select Workspace Folder</div>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="text-xs px-2 py-1 rounded"
                style={{ background: "var(--surface)", color: "var(--dim)", border: "1px solid var(--border)" }}
              >
                ✕ Close
              </button>
            </div>

            <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
              <input
                type="text"
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="Search folders..."
                style={INPUT}
              />
            </div>

            <div className="p-3 overflow-y-auto space-y-2" style={{ maxHeight: "50vh" }}>
              {pickerLoading && (
                <div className="flex flex-col gap-2 px-1 py-1">
                  {[75, 55, 65, 45, 70].map((w, i) => (
                    <div key={i} className="skeleton h-8 rounded" style={{ width: `${w}%`, animationDelay: `${i * 0.07}s` }} />
                  ))}
                </div>
              )}
              {pickerError && (
                <div className="text-xs px-3 py-2 rounded" style={{ color: "#ff4444", background: "rgba(255,68,68,0.1)", border: "1px solid rgba(255,68,68,0.2)" }}>
                  {pickerError}
                </div>
              )}

              {!pickerLoading && workspaceOptions
                .filter((opt) => {
                  if (!pickerSearch.trim()) return true;
                  const q = pickerSearch.toLowerCase();
                  return opt.name.toLowerCase().includes(q) || opt.path.toLowerCase().includes(q);
                })
                .map((opt) => (
                  <button
                    key={opt.path}
                    type="button"
                    onClick={() => {
                      setWorkspace(opt.path);
                      setPickerOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded transition-opacity hover:opacity-85"
                    style={{
                      background: "var(--btn-bg)",
                      border: "1px solid var(--input-border)",
                    }}
                  >
                    <div className="text-xs font-semibold" style={{ color: opt.kind === "project" ? "#00d4ff" : "#ffd700" }}>
                      {opt.name}
                    </div>
                    <div className="text-xs font-mono" style={{ color: "var(--dim)" }}>
                      {opt.path}
                    </div>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Branch/PR Confirmation Modal ──────────────────────────────────────────────

interface BranchPrModalState {
  open: boolean;
  issue: GitHubIssueForQueue | null;
  milestone: { issues: GitHubIssueForQueue[]; title: string } | null;
  projectPath: string;
  repoName: string;
}

function BranchPrModal({
  state,
  onConfirm,
  onCancel,
}: {
  state: BranchPrModalState;
  onConfirm: (opts: { useBranchPr: boolean; scheduleMode: "anytime" | "once"; oneTimeAt?: string }) => void;
  onCancel: () => void;
}) {
  const [useBranchPr, setUseBranchPr] = useState<boolean>(true);
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [oneTimeAt, setOneTimeAt] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hour = String(d.getHours()).padStart(2, "0");
    const minute = String(d.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hour}:${minute}`;
  });

  const taskLabel = state.milestone
    ? state.milestone.title
    : state.issue
      ? `#${state.issue.number} ${state.issue.title}`
      : "task";

  function handleConfirm() {
    if (scheduleMode === "later") {
      const oneTimeDate = new Date(oneTimeAt);
      if (Number.isNaN(oneTimeDate.getTime())) return;
      onConfirm({ useBranchPr, scheduleMode: "once", oneTimeAt: oneTimeDate.toISOString() });
    } else {
      onConfirm({ useBranchPr, scheduleMode: "anytime" });
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      style={{ background: "rgba(0,0,0,0.6)" }}
    >
      <div
        className="w-full max-w-sm flex flex-col rounded-lg overflow-hidden slide-up"
        style={{ background: "var(--card)", border: "1px solid rgba(0,212,255,0.2)" }}
      >
        <div className="px-4 py-3" style={{ background: "rgba(0,212,255,0.06)", borderBottom: "1px solid var(--border)" }}>
          <div className="text-sm font-semibold" style={{ color: "#00d4ff" }}>
            Queue: {taskLabel}
          </div>
          <div className="text-xs mt-1 font-mono" style={{ color: "#4a5568" }}>
            {state.projectPath}
          </div>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div className="space-y-1.5">
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--dim)" }}>
              When
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setScheduleMode("now")}
                type="button"
                className="flex-1 py-2 rounded text-xs font-semibold transition-all"
                style={{
                  background: scheduleMode === "now" ? "rgba(0,255,136,0.12)" : "var(--btn-bg)",
                  color: scheduleMode === "now" ? "#00ff88" : "var(--dim)",
                  border: `1px solid ${scheduleMode === "now" ? "rgba(0,255,136,0.3)" : "var(--input-border)"}`,
                }}
              >
                Queue Now
              </button>
              <button
                onClick={() => setScheduleMode("later")}
                type="button"
                className="flex-1 py-2 rounded text-xs font-semibold transition-all"
                style={{
                  background: scheduleMode === "later" ? "rgba(168,85,247,0.12)" : "var(--btn-bg)",
                  color: scheduleMode === "later" ? "#a855f7" : "var(--dim)",
                  border: `1px solid ${scheduleMode === "later" ? "rgba(168,85,247,0.3)" : "var(--input-border)"}`,
                }}
              >
                Queue Later
              </button>
            </div>
          </div>

          {scheduleMode === "later" && (
            <div className="space-y-1">
              <label className="text-xs" htmlFor="queue-later-at" style={{ color: "#4a5568" }}>
                Run at (local time)
              </label>
              <input
                id="queue-later-at"
                type="datetime-local"
                style={INPUT}
                value={oneTimeAt}
                onChange={(e) => setOneTimeAt(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--dim)" }}>
              Branching
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setUseBranchPr(true)}
                type="button"
                className="flex-1 py-2 rounded text-xs font-semibold transition-all"
                style={{
                  background: useBranchPr ? "rgba(0,212,255,0.12)" : "var(--btn-bg)",
                  color: useBranchPr ? "#00d4ff" : "var(--dim)",
                  border: `1px solid ${useBranchPr ? "rgba(0,212,255,0.3)" : "var(--input-border)"}`,
                }}
              >
                Branch + PR
              </button>
              <button
                onClick={() => setUseBranchPr(false)}
                type="button"
                className="flex-1 py-2 rounded text-xs font-semibold transition-all"
                style={{
                  background: !useBranchPr ? "rgba(0,255,136,0.12)" : "var(--btn-bg)",
                  color: !useBranchPr ? "#00ff88" : "var(--dim)",
                  border: `1px solid ${!useBranchPr ? "rgba(0,255,136,0.3)" : "var(--input-border)"}`,
                }}
              >
                Direct commit
              </button>
            </div>
          </div>
        </div>

        <div className="px-4 py-2 border-t flex justify-between" style={{ borderColor: "var(--border)" }}>
          <button
            onClick={onCancel}
            type="button"
            className="px-3 py-1.5 rounded text-xs transition-opacity hover:opacity-70"
            style={{ color: "#4a5568" }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            type="button"
            className="px-4 py-1.5 rounded text-xs font-bold transition-opacity hover:opacity-80"
            style={{
              background: scheduleMode === "later" ? "rgba(168,85,247,0.15)" : "rgba(0,255,136,0.15)",
              color: scheduleMode === "later" ? "#a855f7" : "#00ff88",
              border: `1px solid ${scheduleMode === "later" ? "rgba(168,85,247,0.4)" : "rgba(0,255,136,0.4)"}`,
            }}
          >
            {scheduleMode === "later" ? "Schedule" : "Queue Now"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

interface GitHubIssueForQueue {
  id: number;
  number: number;
  title: string;
  html_url: string;
  labels: Array<{ name: string; color: string }>;
  milestone: { title: string } | null;
}

export default function SchedulerPage() {
  const [tasks, setTasks]         = useState<Task[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({ state: "stopped" });
  const [loading, setLoading]     = useState(true);
  const [tab, setTab]             = useState<"active" | "all">("active");
  const [showForm, setShowForm]   = useState(false);
  const [report, setReport]       = useState<Task | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [addingIssueId, setAddingIssueId] = useState<number | null>(null);
  const [addingMilestoneId, setAddingMilestoneId] = useState<number | null>(null);
  const [branchPrModal, setBranchPrModal] = useState<BranchPrModalState>({
    open: false,
    issue: null,
    milestone: null,
    projectPath: "",
    repoName: "",
  });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [tasksRes, statusRes] = await Promise.allSettled([
        fetch("/api/scheduler/tasks"),
        fetch("/api/openclaw/status"),
      ]);
      if (tasksRes.status === "fulfilled" && tasksRes.value.ok) {
        const d = await tasksRes.value.json();
        setTasks(d.tasks ?? []);
      }
      if (statusRes.status === "fulfilled" && statusRes.value.ok) {
        setAgentStatus(await statusRes.value.json());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    timerRef.current = setInterval(fetchAll, 5000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchAll]);

  const handleAddIssueToQueue = useCallback((issue: GitHubIssueForQueue, _repoOwner: string, repoName: string, projectPath: string) => {
    setBranchPrModal({
      open: true,
      issue,
      milestone: null,
      projectPath,
      repoName,
    });
  }, []);

  const handleBranchPrConfirm = useCallback(async (opts: { useBranchPr: boolean; scheduleMode: "anytime" | "once"; oneTimeAt?: string }) => {
    const { useBranchPr, scheduleMode, oneTimeAt } = opts;
    const { issue, milestone, projectPath, repoName } = branchPrModal;
    setBranchPrModal({ open: false, issue: null, milestone: null, projectPath: "", repoName: "" });

    if (milestone && milestone.issues.length > 0) {
      setAddingMilestoneId(Date.now());
      try {
        const issuesList = milestone.issues.map(i => `- Issue #${i.number}: ${i.title}\n  ${i.html_url}`).join('\n');
        let description = `Working on milestone "${milestone.title}" in repository "${repoName}".\n\nWorking directory: ${projectPath}\n\nIssues to complete sequentially:\n${issuesList}`;
        if (useBranchPr) {
          description += `\n\nIMPORTANT: Create a new branch for this work. When all issues are resolved, open a pull request.`;
        }
        const title = `${repoName}: ${milestone.title} - ${milestone.issues.length} issues`;

        const payload: Record<string, unknown> = {
          type: "coding",
          title,
          description,
          workspace: projectPath,
          preferred_tool: "opencode",
          schedule_mode: scheduleMode,
        };

        if (scheduleMode === "once" && oneTimeAt) {
          payload.one_time_at = oneTimeAt;
          payload.scheduled_at = oneTimeAt;
        }

        const res = await fetch("/api/scheduler/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to create task");
        }
        fetchAll();
      } catch (err) {
        console.error("Failed to add issue to queue:", err);
      } finally {
        setAddingIssueId(null);
      }
    }
  }, [branchPrModal, fetchAll]);

  const handleAddMilestoneToQueue = useCallback((issues: GitHubIssueForQueue[], milestoneTitle: string, _repoOwner: string, repoName: string, projectPath: string) => {
    setBranchPrModal({
      open: true,
      issue: null,
      milestone: { issues, title: milestoneTitle },
      projectPath,
      repoName,
    });
  }, []);

  async function deleteTask(id: string) {
    await fetch(`/api/scheduler/tasks/${id}`, { method: "DELETE" });
    if (editingTask?.id === id) setEditingTask(null);
    fetchAll();
  }

  async function queueNowTask(id: string) {
    await fetch(`/api/scheduler/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "queue_now" }),
    });
    fetchAll();
  }

  async function saveEdit(id: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/scheduler/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error ?? "Failed to update task");
    }
    setEditingTask(null);
    fetchAll();
  }

  const active    = tasks.filter((t) => ["pending", "running", "scheduled", "manual", "rate_limited"].includes(t.status));
  const displayed = tab === "active" ? active : tasks;

  const pending  = active.filter((t) => t.status === "pending").length;
  const running  = active.filter((t) => t.status === "running").length;
  const sched    = active.filter((t) => t.status === "scheduled").length;
  const manual   = active.filter((t) => t.status === "manual").length;

  const agentColor = AGENT_STATE_COLOR[agentStatus.state] ?? "#4a5568";
  const currentTask = agentStatus.current_task_id ? tasks.find((t) => t.id === agentStatus.current_task_id) : null;

  const effectiveState = running > 0 ? "running" as const : agentStatus.state;
  const effectiveColor = running > 0 ? AGENT_STATE_COLOR.running ?? "#00ff88" : agentColor;

  return (
    <div className="max-w-screen-lg mx-auto px-4 py-6 space-y-6 fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded flex items-center justify-center"
            style={{ background: "rgba(255,215,0,0.1)", border: "1px solid rgba(255,215,0,0.25)" }}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="#ffd700" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <title>Scheduler</title>
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <line x1="8" y1="14" x2="8" y2="14" />
              <line x1="12" y1="14" x2="12" y2="14" />
              <line x1="16" y1="14" x2="16" y2="14" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: "#ffd700" }}>Scheduler</h1>
            <p className="text-xs" style={{ color: "#4a5568" }}>Runs via <span style={{ color: "#00ff88" }}>OpenCode Server</span> — live activity & intervention</p>
          </div>
        </div>

        {/* Stats + new button */}
        <div className="flex items-center gap-3">
          {/* Agent status pill */}
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs"
            style={{ background: `${effectiveColor}12`, border: `1px solid ${effectiveColor}35`, color: effectiveColor }}
          >
            {effectiveState === "running"
              ? <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: effectiveColor }} />
              : <span className="w-1.5 h-1.5 rounded-full" style={{ background: effectiveColor }} />}
            <span className="font-medium uppercase tracking-wider">{effectiveState}</span>
            {currentTask && <span className="truncate max-w-24 opacity-70">{currentTask.title}</span>}
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            {running > 0 && (
              <span className="px-2 py-1 rounded" style={{ background: "rgba(0,212,255,0.1)", color: "#00d4ff", border: "1px solid rgba(0,212,255,0.2)" }}>
                {running} running
              </span>
            )}
            {pending > 0 && (
              <span className="px-2 py-1 rounded" style={{ background: "rgba(255,215,0,0.1)", color: "#ffd700", border: "1px solid rgba(255,215,0,0.2)" }}>
                {pending} pending
              </span>
            )}
            {sched > 0 && (
              <span className="px-2 py-1 rounded" style={{ background: "rgba(168,85,247,0.1)", color: "#a855f7", border: "1px solid rgba(168,85,247,0.2)" }}>
                {sched} scheduled
              </span>
            )}
            {manual > 0 && (
              <span className="px-2 py-1 rounded" style={{ background: "rgba(249,115,22,0.1)", color: "#f97316", border: "1px solid rgba(249,115,22,0.2)" }}>
                {manual} manual
              </span>
            )}
          </div>
          <button
            onClick={() => { setShowForm((v) => !v); setEditingTask(null); }}
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-semibold transition-all"
            style={{
              background: showForm ? "var(--btn-bg)" : "rgba(0,255,136,0.12)",
              color: showForm ? "var(--dim)" : "#00ff88",
              border: `1px solid ${showForm ? "var(--input-border)" : "rgba(0,255,136,0.3)"}`,
            }}
          >
            {showForm ? "✕ Cancel" : "+ New Task"}
          </button>
        </div>
      </div>

      {/* New task form */}
      {showForm && (
        <NewTaskForm
          onCreated={() => { setShowForm(false); fetchAll(); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Git Issues Panel */}
      <IssuesPanel 
        onAddToQueue={handleAddIssueToQueue} 
        addingIssueId={addingIssueId}
        onAddMilestoneToQueue={handleAddMilestoneToQueue}
        addingMilestoneId={addingMilestoneId}
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b overflow-x-auto" style={{ borderColor: "var(--border)" }}>
        {([
          { key: "active", label: `Active (${active.length})` },
          { key: "all", label: `All (${tasks.length})` },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            type="button"
            className="px-4 py-2 text-sm font-medium transition-colors relative"
            style={{
              color: tab === t.key ? "var(--text)" : "#4a5568",
              borderBottom: tab === t.key ? "2px solid #ffd700" : "2px solid transparent",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Task list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card p-4 space-y-3" style={{ animationDelay: `${(i - 1) * 0.08}s` }}>
              <div className="flex items-center gap-3">
                <div className="skeleton h-3 w-3 rounded-full" />
                <div className="skeleton h-4 rounded" style={{ width: "55%" }} />
                <div className="skeleton h-5 rounded ml-auto" style={{ width: "15%" }} />
              </div>
              <div className="skeleton h-3 rounded" style={{ width: "80%" }} />
              <div className="skeleton h-3 rounded" style={{ width: "40%" }} />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3 fade-in">
          {displayed.length === 0 ? (
            <div
              className="card flex flex-col items-center justify-center py-16 gap-3"
              style={{ color: "#4a5568" }}
            >
              <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <title>No tasks</title>
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <div className="text-sm">
                {tab === "active" ? "No active tasks — create one above" : "No tasks yet"}
              </div>
            </div>
          ) : (
            displayed
              .slice()
              .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
              .map((task, i) => (
                <div key={task.id} className="slide-up" style={{ "--i": i } as React.CSSProperties}>
                  <TaskCard
                    task={task}
                    onEdit={() => { setShowForm(false); setEditingTask(editingTask?.id === task.id ? null : task); }}
                    onDelete={() => deleteTask(task.id)}
                    onViewReport={() => setReport(task)}
                    onQueueNow={() => queueNowTask(task.id)}
                  />
                </div>
              ))
          )}
        </div>
      )}

      {/* Report modal */}
      {report && <ReportModal task={report} onClose={() => setReport(null)} />}

      {/* Branch/PR confirmation modal */}
      {branchPrModal.open && (
        <BranchPrModal
          state={branchPrModal}
          onConfirm={handleBranchPrConfirm}
          onCancel={() => setBranchPrModal({ open: false, issue: null, milestone: null, projectPath: "", repoName: "" })}
        />
      )}
    </div>
  );
}
