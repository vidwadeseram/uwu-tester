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
  preferred_tool?: "claude" | "opencode" | "auto";
  status: "pending" | "running" | "completed" | "failed" | "scheduled" | "manual";
  schedule_mode?: "anytime" | "once" | "daily" | "weekly" | "manual";
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

interface WorkspaceOption {
  name: string;
  path: string;
  kind: "group" | "project";
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
  pending:   "#ffd700",
  running:   "#00d4ff",
  completed: "#00ff88",
  failed:    "#ff4444",
  scheduled: "#a855f7",
  manual:    "#f97316",
};

const STATUS_BG: Record<string, string> = {
  pending:   "rgba(255,215,0,0.1)",
  running:   "rgba(0,212,255,0.1)",
  completed: "rgba(0,255,136,0.1)",
  failed:    "rgba(255,68,68,0.1)",
  scheduled: "rgba(168,85,247,0.1)",
  manual:    "rgba(249,115,22,0.1)",
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
        style={{ background: "#0f1629", border: "1px solid #1e2d4a" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0"
          style={{ borderColor: "#1e2d4a" }}
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
              {task.status}
            </span>
            <span className="font-semibold text-sm truncate" style={{ color: "#e2e8f0" }}>
              {task.title}
            </span>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="text-xs px-2 py-1 rounded ml-3 flex-shrink-0"
            style={{ background: "rgba(30,45,74,0.6)", color: "#94a3b8", border: "1px solid #1e2d4a" }}
          >
            ✕ Close
          </button>
        </div>

        {/* Meta */}
        <div
          className="flex flex-wrap gap-4 px-5 py-3 text-xs border-b flex-shrink-0"
          style={{ borderColor: "#1e2d4a", color: "#94a3b8" }}
        >
          <span>Type: <span style={{ color: task.type === "coding" ? "#00d4ff" : "#a855f7" }}>{task.type}</span></span>
          {task.workspace && <span>Workspace: <span style={{ color: "#e2e8f0" }} className="font-mono">{task.workspace}</span></span>}
          {task.preferred_tool && <span>Tool: <span style={{ color: "#ffd700" }}>{task.preferred_tool}</span></span>}
          <span>Created: {fmtDate(task.created_at)}</span>
          {task.started_at && <span>Started: {fmtDate(task.started_at)}</span>}
          {task.completed_at && <span>Completed: {fmtDate(task.completed_at)}</span>}
        </div>

        {/* Task description */}
        <div className="px-5 py-3 border-b flex-shrink-0" style={{ borderColor: "#1e2d4a" }}>
          <div className="text-xs mb-1" style={{ color: "#4a5568" }}>Task</div>
          <div className="text-sm" style={{ color: "#94a3b8" }}>{task.description}</div>
        </div>

        {/* Report */}
        <div className="flex-1 overflow-auto px-5 py-4">
          {task.report ? (
            <pre
              className="text-xs leading-relaxed whitespace-pre-wrap font-mono"
              style={{ color: "#e2e8f0" }}
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
  onDelete,
  onViewReport,
  onQueueNow,
}: {
  task: Task;
  onDelete: () => void;
  onViewReport: () => void;
  onQueueNow: () => void;
}) {
  const color = STATUS_COLOR[task.status] ?? "#94a3b8";
  const bg    = STATUS_BG[task.status]    ?? "rgba(30,45,74,0.2)";
  const isActive = ["pending", "running", "scheduled"].includes(task.status);

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
          <span className="font-semibold text-sm truncate" style={{ color: "#e2e8f0" }}>
            {task.title}
          </span>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Status badge */}
          <span
            className="text-xs px-2 py-0.5 rounded font-medium uppercase tracking-wider"
            style={{ background: bg, color, border: `1px solid ${color}40` }}
          >
            {task.status}
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
      <div className="text-xs leading-relaxed line-clamp-2" style={{ color: "#94a3b8" }}>
        {task.description}
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: "#4a5568" }}>
        {task.workspace && (
          <span className="font-mono truncate max-w-48" style={{ color: "#94a3b8" }}>
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
        {(task.status === "failed" || task.status === "scheduled" || task.status === "manual") && (
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
            {task.status === "manual" ? "Add to Queue" : "Queue Now"}
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
    </div>
  );
}

// ── New Task Form ─────────────────────────────────────────────────────────────

const INPUT = {
  background: "rgba(10,14,26,0.8)",
  border: "1px solid rgba(30,45,74,0.8)",
  color: "#e2e8f0",
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
  const [type, setType] = useState<"coding" | "research">("research");
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
  const [tool, setTool] = useState<"auto" | "claude" | "opencode">("auto");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState("");
  const [pickerSearch, setPickerSearch] = useState("");
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceOption[]>([]);

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
      preferred_tool: type === "coding" ? tool : undefined,
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

      {/* Type */}
      <div className="flex gap-2">
        {(["research", "coding"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className="flex-1 py-2 rounded text-sm font-medium transition-all"
            style={{
              background: type === t
                ? (t === "coding" ? "rgba(0,212,255,0.15)" : "rgba(168,85,247,0.15)")
                : "rgba(30,45,74,0.3)",
              color: type === t ? (t === "coding" ? "#00d4ff" : "#a855f7") : "#4a5568",
              border: `1px solid ${type === t ? (t === "coding" ? "rgba(0,212,255,0.4)" : "rgba(168,85,247,0.4)") : "rgba(30,45,74,0.5)"}`,
            }}
          >
            {t === "coding" ? "💻 Coding" : "🔬 Research"}
          </button>
        ))}
      </div>

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
                background: scheduleMode === mode.key ? "rgba(249,115,22,0.15)" : "rgba(30,45,74,0.3)",
                color: scheduleMode === mode.key ? "#f59e0b" : "#94a3b8",
                border: `1px solid ${scheduleMode === mode.key ? "rgba(249,115,22,0.4)" : "rgba(30,45,74,0.5)"}`,
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
            <div className="text-xs" style={{ color: "#4a5568" }}>Workspace</div>
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
                  background: "rgba(10,14,26,0.8)",
                  border: "1px solid rgba(30,45,74,0.8)",
                  color: "#e2e8f0",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={workspace}
              >
                {workspace}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1 lg:w-[140px]">
            <label className="text-xs" htmlFor="tool" style={{ color: "#4a5568" }}>Tool</label>
            <select
              id="tool"
              style={{ ...SELECT, width: "100%" }}
              value={tool}
              onChange={(e) => setTool(e.target.value as "auto" | "claude" | "opencode")}
            >
              <option value="auto">Auto</option>
              <option value="claude">Claude Code</option>
              <option value="opencode">OpenCode</option>
            </select>
          </div>
        </div>
      )}

      {/* Description */}
      <div className="flex flex-col gap-1">
        <label className="text-xs" htmlFor="description" style={{ color: "#4a5568" }}>
          {type === "coding" ? "What should be done?" : "Research question / prompt"}
        </label>
        <textarea
          id="description"
          style={{ ...INPUT, minHeight: "100px", resize: "vertical" }}
          placeholder={
            type === "coding"
              ? "Describe the coding task in detail. openclaw will use opencode or claude code to complete it."
              : "Ask a question, request research, or describe what you need to know."
          }
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
            background: loading ? "rgba(30,45,74,0.5)" : "rgba(0,255,136,0.15)",
            color: loading ? "#4a5568" : "#00ff88",
            border: "1px solid rgba(0,255,136,0.3)",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Creating…" : scheduleMode === "anytime" ? "Queue Task" : scheduleMode === "manual" ? "Create Manual Task" : "Schedule Task"}
        </button>
        <button
          onClick={onCancel}
          type="button"
          className="px-4 py-2 rounded text-sm transition-opacity hover:opacity-70"
          style={{ background: "rgba(30,45,74,0.4)", color: "#94a3b8", border: "1px solid rgba(30,45,74,0.7)" }}
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
            style={{ background: "#0f1629", border: "1px solid #1e2d4a" }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "#1e2d4a" }}>
              <div className="text-sm font-semibold" style={{ color: "#00d4ff" }}>Select Workspace Folder</div>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="text-xs px-2 py-1 rounded"
                style={{ background: "rgba(30,45,74,0.6)", color: "#94a3b8", border: "1px solid #1e2d4a" }}
              >
                ✕ Close
              </button>
            </div>

            <div className="px-4 py-3 border-b" style={{ borderColor: "#1e2d4a" }}>
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
                <div className="text-xs px-3 py-2 rounded" style={{ color: "#94a3b8", background: "rgba(30,45,74,0.3)" }}>
                  Loading folders...
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
                      background: "rgba(30,45,74,0.35)",
                      border: "1px solid rgba(30,45,74,0.7)",
                    }}
                  >
                    <div className="text-xs font-semibold" style={{ color: opt.kind === "project" ? "#00d4ff" : "#ffd700" }}>
                      {opt.name}
                    </div>
                    <div className="text-xs font-mono" style={{ color: "#94a3b8" }}>
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
  const [loading, setLoading]     = useState(true);
  const [tab, setTab]             = useState<"active" | "completed">("active");
  const [showForm, setShowForm]   = useState(false);
  const [report, setReport]       = useState<Task | null>(null);
  const [addingIssueId, setAddingIssueId] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/scheduler/tasks");
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    timerRef.current = setInterval(fetchTasks, 5000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchTasks]);

  const handleAddIssueToQueue = useCallback(async (issue: GitHubIssueForQueue, repoOwner: string, repoName: string) => {
    setAddingIssueId(issue.id);
    try {
      const description = `GitHub Issue #${issue.number}: ${issue.title}\n\n${issue.html_url}`;
      const res = await fetch("/api/scheduler/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "coding",
          title: issue.title,
          description,
          schedule_mode: "anytime",
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create task");
      }
      fetchTasks();
    } catch (err) {
      console.error("Failed to add issue to queue:", err);
    } finally {
      setAddingIssueId(null);
    }
  }, [fetchTasks]);

  async function deleteTask(id: string) {
    await fetch(`/api/scheduler/tasks/${id}`, { method: "DELETE" });
    fetchTasks();
  }

  async function queueNowTask(id: string) {
    await fetch(`/api/scheduler/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "queue_now" }),
    });
    fetchTasks();
  }

  const active    = tasks.filter((t) => ["pending", "running", "scheduled", "manual"].includes(t.status));
  const completed = tasks.filter((t) => ["completed", "failed"].includes(t.status));

  const pending  = active.filter((t) => t.status === "pending").length;
  const running  = active.filter((t) => t.status === "running").length;
  const sched    = active.filter((t) => t.status === "scheduled").length;
  const manual   = active.filter((t) => t.status === "manual").length;

  return (
    <div className="max-w-screen-lg mx-auto px-4 py-6 space-y-6">
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
            <p className="text-xs" style={{ color: "#4a5568" }}>Tasks queued for openclaw</p>
          </div>
        </div>

        {/* Stats + new button */}
        <div className="flex flex-wrap items-center gap-3">
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
            onClick={() => setShowForm((v) => !v)}
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-semibold transition-all"
            style={{
              background: showForm ? "rgba(30,45,74,0.5)" : "rgba(0,255,136,0.12)",
              color: showForm ? "#94a3b8" : "#00ff88",
              border: `1px solid ${showForm ? "rgba(30,45,74,0.7)" : "rgba(0,255,136,0.3)"}`,
            }}
          >
            {showForm ? "✕ Cancel" : "+ New Task"}
          </button>
        </div>
      </div>

      {/* New task form */}
      {showForm && (
        <NewTaskForm
          onCreated={() => { setShowForm(false); fetchTasks(); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Git Issues Panel */}
      <IssuesPanel onAddToQueue={handleAddIssueToQueue} addingIssueId={addingIssueId} />

      {/* Tabs */}
      <div className="flex gap-1 border-b overflow-x-auto" style={{ borderColor: "#1e2d4a" }}>
        {(["active", "completed"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            type="button"
            className="px-4 py-2 text-sm font-medium transition-colors relative"
            style={{
              color: tab === t ? "#e2e8f0" : "#4a5568",
              borderBottom: tab === t ? "2px solid #ffd700" : "2px solid transparent",
            }}
          >
            {t === "active" ? `Active (${active.length})` : `Completed (${completed.length})`}
          </button>
        ))}
      </div>

      {/* Task list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card animate-pulse" style={{ height: 100 }} />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {(tab === "active" ? active : completed).length === 0 ? (
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
                {tab === "active" ? "No active tasks — create one above" : "No completed tasks yet"}
              </div>
            </div>
          ) : (
            (tab === "active" ? active : completed)
              .slice()
              .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
              .map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onDelete={() => deleteTask(task.id)}
                  onViewReport={() => setReport(task)}
                  onQueueNow={() => queueNowTask(task.id)}
                />
              ))
          )}
        </div>
      )}

      {/* Report modal */}
      {report && <ReportModal task={report} onClose={() => setReport(null)} />}
    </div>
  );
}
