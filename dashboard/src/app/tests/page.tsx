"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ─── MCP Modal ────────────────────────────────────────────────────────────────

type McpTarget = "claude" | "opencode";

function McpModal({
  target,
  project,
  onClose,
}: {
  target: McpTarget;
  project: string;
  onClose: () => void;
}) {
  const [regressionDir, setRegressionDir] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/tests/mcp-info")
      .then((r) => r.json())
      .then((d) => setRegressionDir(d.regression_dir))
      .catch(() => setRegressionDir("/opt/vps-dashboard/regression_tests"));
  }, []);

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    });
  }

  const dir = regressionDir ?? "/opt/vps-dashboard/regression_tests";

  const mcpJsonConfig = JSON.stringify(
    {
      mcpServers: {
        "uwu-tester": {
          type: "stdio",
          command: "uv",
          args: ["run", "mcp_server.py"],
          cwd: dir,
        },
      },
    },
    null,
    2
  );

  const opencodeMcpConfig = JSON.stringify(
    {
      mcp: {
        "uwu-tester": {
          command: ["uv", "run", "mcp_server.py"],
          cwd: dir,
        },
      },
    },
    null,
    2
  );

  const claudeCmd = `claude --mcp-config /path/to/.mcp.json "Use the uwu-tester MCP server to run tests for the '${project}' project, then give me a detailed pass/fail report for each test case."`;
  const opencodeCmd = `opencode "Use the uwu-tester MCP server to run tests for the '${project}' project, then give me a detailed pass/fail report for each test case."`;

  const isClaudeCode = target === "claude";
  const accent = isClaudeCode ? "#f97316" : "#a855f7";
  const title = isClaudeCode ? "Test via Claude Code" : "Test via Opencode";
  const icon = isClaudeCode ? (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 12h8M12 8v8" />
    </svg>
  ) : (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" />
    </svg>
  );

  const configBlock = isClaudeCode ? mcpJsonConfig : opencodeMcpConfig;
  const configKey = isClaudeCode ? "Add to .mcp.json in your project root" : "Add to ~/.config/opencode/config.json";
  const cmdKey = isClaudeCode ? "Run in terminal" : "Run in terminal";
  const cmd = isClaudeCode ? claudeCmd : opencodeCmd;

  function CodeBlock({ text, copyKey, label }: { text: string; copyKey: string; label: string }) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium" style={{ color: "#94a3b8" }}>{label}</span>
          <button
            onClick={() => copy(text, copyKey)}
            className="text-xs px-2 py-0.5 rounded transition-colors"
            style={{
              background: copied === copyKey ? "rgba(0,255,136,0.12)" : "rgba(30,45,74,0.6)",
              color: copied === copyKey ? "#00ff88" : "#94a3b8",
              border: `1px solid ${copied === copyKey ? "rgba(0,255,136,0.3)" : "#1e2d4a"}`,
            }}
          >
            {copied === copyKey ? "✓ Copied" : "Copy"}
          </button>
        </div>
        <pre
          className="p-3 rounded-lg text-xs overflow-x-auto"
          style={{ background: "rgba(0,0,0,0.4)", color: "#e2e8f0", border: "1px solid #1e2d4a", fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all" }}
        >
          {text}
        </pre>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-xl flex flex-col gap-4 p-5"
        style={{ background: "#0a0e1a", border: `1px solid rgba(${hexRgb(accent)}, 0.3)`, maxHeight: "90vh", overflowY: "auto" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span style={{ color: accent }}>{icon}</span>
            <h2 className="text-sm font-bold" style={{ color: "#e2e8f0" }}>{title}</h2>
          </div>
          <button onClick={onClose} className="text-xs px-2 py-1 rounded" style={{ color: "#4a5568", background: "rgba(30,45,74,0.4)" }}>✕</button>
        </div>

        <p className="text-xs" style={{ color: "#4a5568" }}>
          The MCP server exposes test projects, cases, and results as resources, and lets the AI agent run tests on your behalf.
          Follow the steps below to connect it to{" "}
          <span style={{ color: accent }}>{isClaudeCode ? "Claude Code" : "Opencode"}</span>.
        </p>

        {/* Step 1: install deps */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold" style={{ color: accent }}>Step 1 — install MCP server deps</span>
          <CodeBlock
            text={`cd ${dir}\nuv sync`}
            copyKey="install"
            label="Run once in your terminal"
          />
        </div>

        {/* Step 2: add MCP config */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold" style={{ color: accent }}>Step 2 — add MCP server config</span>
          <CodeBlock text={configBlock} copyKey="config" label={configKey} />
        </div>

        {/* Step 3: prompt */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold" style={{ color: accent }}>Step 3 — run your agent</span>
          <CodeBlock text={cmd} copyKey="cmd" label={cmdKey} />
        </div>

        {/* Resources reference */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold" style={{ color: accent }}>Available MCP resources</span>
          <div className="p-3 rounded-lg text-xs flex flex-col gap-1" style={{ background: "rgba(0,0,0,0.3)", border: "1px solid #1e2d4a", fontFamily: "monospace" }}>
            {[
              ["uwu://projects", "List all projects"],
              [`uwu://projects/${project}/cases`, "Test cases for this project"],
              [`uwu://projects/${project}/results`, "Recent run summaries"],
              [`uwu://projects/${project}/results/{run_id}`, "Full result for one run"],
            ].map(([uri, desc]) => (
              <div key={uri} className="flex gap-2">
                <span style={{ color: accent, minWidth: "0", flexShrink: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{uri}</span>
                <span style={{ color: "#4a5568", flexShrink: 0 }}>— {desc}</span>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={onClose}
          className="self-end px-4 py-1.5 rounded text-xs font-medium"
          style={{ background: "rgba(30,45,74,0.6)", color: "#94a3b8", border: "1px solid #1e2d4a" }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

function hexRgb(hex: string) {
  const m = hex.replace("#", "").match(/.{2}/g);
  if (!m) return "0,0,0";
  return m.map((x) => parseInt(x, 16)).join(",");
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface TestCase {
  id: string;
  label: string;
  task: string;
  enabled: boolean;
  depends_on?: string | null;
  skip_dependents_on_fail?: boolean;
}

interface TestConfig {
  project: string;
  description: string;
  test_cases: TestCase[];
}

interface CaseResult {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
  duration_s: number;
  skipped: boolean;
  recording?: string | null;
}

interface RunResult {
  project: string;
  run_id: string;
  started_at: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  results: CaseResult[];
}

/** Extract all {{VAR}} placeholders from a list of test cases */
function extractVars(testCases: TestCase[]): string[] {
  const found: Record<string, true> = {};
  for (const tc of testCases) {
    let m: RegExpExecArray | null;
    const re = /\{\{([A-Z0-9_]+)\}\}/g;
    while ((m = re.exec(tc.task)) !== null) found[m[1]] = true;
  }
  return Object.keys(found).sort();
}

function isSensitive(key: string) {
  return /PASSWORD|SECRET|TOKEN|KEY|PASS/i.test(key);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(iso: string) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

const INPUT_STYLE = {
  background: "rgba(10, 14, 26, 0.8)",
  border: "1px solid rgba(30, 45, 74, 0.8)",
  color: "#e2e8f0",
};

const BTN = (active = true, accent = "#00d4ff") => ({
  background: active ? `rgba(${hexToRgb(accent)}, 0.12)` : "rgba(30,45,74,0.3)",
  border: `1px solid rgba(${hexToRgb(accent)}, ${active ? "0.3" : "0.1"})`,
  color: active ? accent : "#4a5568",
  cursor: active ? "pointer" : "not-allowed",
});

function hexToRgb(hex: string) {
  const m = hex.replace("#", "").match(/.{2}/g);
  if (!m) return "0,0,0";
  return m.map((x) => parseInt(x, 16)).join(",");
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CaseEditor({
  initial,
  allCaseIds,
  onSave,
  onCancel,
}: {
  initial: Partial<TestCase>;
  allCaseIds: string[];
  onSave: (tc: TestCase) => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState(initial.id ?? "");
  const [label, setLabel] = useState(initial.label ?? "");
  const [task, setTask] = useState(initial.task ?? "");
  const [enabled, setEnabled] = useState(initial.enabled ?? true);
  const [dependsOn, setDependsOn] = useState(initial.depends_on ?? "");
  const [skipDeps, setSkipDeps] = useState(initial.skip_dependents_on_fail ?? false);
  const [error, setError] = useState("");

  const isNew = !initial.id;

  const handleLabelChange = (v: string) => {
    setLabel(v);
    if (isNew) setId(slugify(v));
  };

  const handleSave = () => {
    if (!id.trim()) { setError("ID is required"); return; }
    if (!label.trim()) { setError("Label is required"); return; }
    if (!task.trim()) { setError("Task is required"); return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) { setError("ID must be alphanumeric / _ -"); return; }
    onSave({
      id: id.trim(),
      label: label.trim(),
      task: task.trim(),
      enabled,
      depends_on: dependsOn.trim() || null,
      skip_dependents_on_fail: skipDeps,
    });
  };

  const otherIds = allCaseIds.filter((c) => c !== id);

  return (
    <div
      className="rounded p-4 space-y-3"
      style={{ background: "rgba(30,45,74,0.4)", border: "1px solid rgba(0,212,255,0.2)" }}
    >
      <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#00d4ff" }}>
        {isNew ? "New Test Case" : "Edit Test Case"}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs" style={{ color: "#94a3b8" }}>Label</label>
          <input
            className="px-3 py-1.5 rounded text-xs outline-none"
            style={INPUT_STYLE}
            value={label}
            onChange={(e) => handleLabelChange(e.target.value)}
            placeholder="Web Portal Login"
            onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(0,212,255,0.4)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(30,45,74,0.8)")}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs" style={{ color: "#94a3b8" }}>ID (slug)</label>
          <input
            className="px-3 py-1.5 rounded text-xs font-mono outline-none"
            style={INPUT_STYLE}
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="web_portal_login"
            disabled={!isNew}
            onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(0,212,255,0.4)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(30,45,74,0.8)")}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs" style={{ color: "#94a3b8" }}>
          Task prompt{" "}
          <span style={{ color: "#4a5568" }}>
            (use {"{{VAR}}"} for env substitution)
          </span>
        </label>
        <textarea
          className="px-3 py-2 rounded text-xs font-mono outline-none resize-y"
          style={{ ...INPUT_STYLE, minHeight: 96 }}
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Go to https://example.com and..."
          onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(0,212,255,0.4)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(30,45,74,0.8)")}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs" style={{ color: "#94a3b8" }}>Depends on</label>
          <select
            className="px-3 py-1.5 rounded text-xs outline-none"
            style={{ ...INPUT_STYLE, appearance: "auto" }}
            value={dependsOn}
            onChange={(e) => setDependsOn(e.target.value)}
          >
            <option value="">— none —</option>
            {otherIds.map((cid) => (
              <option key={cid} value={cid}>
                {cid}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2 justify-center">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="w-3 h-3"
            />
            <span className="text-xs" style={{ color: "#94a3b8" }}>Enabled</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={skipDeps}
              onChange={(e) => setSkipDeps(e.target.checked)}
              className="w-3 h-3"
            />
            <span className="text-xs" style={{ color: "#94a3b8" }}>Skip dependents on fail</span>
          </label>
        </div>
      </div>

      {error && (
        <div className="text-xs px-2 py-1 rounded" style={{ background: "rgba(255,68,68,0.1)", color: "#ff4444", border: "1px solid rgba(255,68,68,0.2)" }}>
          {error}
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded text-xs"
          style={BTN(true, "#94a3b8")}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          className="px-3 py-1.5 rounded text-xs font-medium"
          style={BTN(true, "#00d4ff")}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function VideoModal({ src, label, onClose }: { src: string; label: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-lg overflow-hidden space-y-0"
        style={{ border: "1px solid rgba(0,212,255,0.3)", background: "#0a0e1a" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: "1px solid rgba(30,45,74,0.8)" }}>
          <span className="text-xs font-medium" style={{ color: "#e2e8f0" }}>{label}</span>
          <button onClick={onClose} className="text-xs px-2 py-1 rounded" style={{ color: "#4a5568" }}>✕ close</button>
        </div>
        <video
          src={src}
          controls
          autoPlay
          className="w-full"
          style={{ maxHeight: "70vh", background: "#000" }}
        />
      </div>
    </div>
  );
}

function RunResultCard({ run, defaultOpen }: { run: RunResult; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [videoSrc, setVideoSrc] = useState<{ src: string; label: string } | null>(null);

  const statusColor =
    run.failed > 0
      ? "#ff4444"
      : run.skipped > 0
      ? "#ffd700"
      : "#00ff88";

  return (
    <>
    {videoSrc && <VideoModal src={videoSrc.src} label={videoSrc.label} onClose={() => setVideoSrc(null)} />}
    <div
      className="rounded overflow-hidden"
      style={{ border: "1px solid rgba(30,45,74,0.8)" }}
    >
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors hover:bg-white/5"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: statusColor, boxShadow: `0 0 6px ${statusColor}` }}
          />
          <span className="text-xs font-mono" style={{ color: "#94a3b8" }}>
            {formatTime(run.started_at)}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs" style={{ color: "#00ff88" }}>
            {run.passed}/{run.total} passed
          </span>
          {run.failed > 0 && (
            <span className="text-xs" style={{ color: "#ff4444" }}>
              {run.failed} failed
            </span>
          )}
          {run.skipped > 0 && (
            <span className="text-xs" style={{ color: "#ffd700" }}>
              {run.skipped} skipped
            </span>
          )}
          <svg
            className="w-3.5 h-3.5 transition-transform"
            style={{ color: "#4a5568", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="border-t" style={{ borderColor: "rgba(30,45,74,0.8)" }}>
          {run.results.map((r) => {
            const color = r.passed ? "#00ff88" : r.skipped ? "#ffd700" : "#ff4444";
            return (
              <div
                key={r.id}
                className="px-4 py-2.5 border-b last:border-b-0 flex items-start gap-3"
                style={{ borderColor: "rgba(30,45,74,0.5)" }}
              >
                <svg
                  className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={color}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {r.passed ? (
                    <polyline points="20 6 9 17 4 12" />
                  ) : r.skipped ? (
                    <line x1="5" y1="12" x2="19" y2="12" />
                  ) : (
                    <>
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </>
                  )}
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium" style={{ color: "#e2e8f0" }}>
                      {r.label}
                    </span>
                    <span className="text-xs font-mono flex-shrink-0" style={{ color: "#4a5568" }}>
                      {r.duration_s > 0 ? `${r.duration_s}s` : "—"}
                    </span>
                  </div>
                  {r.detail && (
                    <p
                      className="text-xs mt-0.5 font-mono break-words"
                      style={{ color: "#94a3b8", maxHeight: 80, overflowY: "auto" }}
                    >
                      {r.detail}
                    </p>
                  )}
                  {r.recording && (
                    <button
                      onClick={() => setVideoSrc({ src: `/api/tests/recordings?file=${encodeURIComponent(r.recording!)}`, label: r.label })}
                      className="inline-flex items-center gap-1 mt-1 text-xs px-2 py-0.5 rounded"
                      style={{ background: "rgba(0,212,255,0.08)", color: "#00d4ff", border: "1px solid rgba(0,212,255,0.2)" }}
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
                      </svg>
                      Watch Recording
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TestsPage() {
  const [projects, setProjects] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [config, setConfig] = useState<TestConfig | null>(null);
  const [results, setResults] = useState<RunResult[]>([]);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [editingCase, setEditingCase] = useState<Partial<TestCase> | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newProjectSlug, setNewProjectSlug] = useState("");
  const [showNewProject, setShowNewProject] = useState(false);
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const [mcpModal, setMcpModal] = useState<McpTarget | null>(null);
  const [envSaving, setEnvSaving] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load project list
  const loadProjects = useCallback(async () => {
    const res = await fetch("/api/tests/cases");
    if (res.ok) {
      const data = await res.json();
      setProjects(data.projects ?? []);
      if (!selectedProject && data.projects?.length > 0) {
        setSelectedProject(data.projects[0]);
      }
    }
  }, [selectedProject]);

  // Load config for selected project
  const loadConfig = useCallback(async (slug: string) => {
    const res = await fetch(`/api/tests/cases?project=${encodeURIComponent(slug)}`);
    if (res.ok) {
      const data = await res.json();
      setConfig(data);
    }
  }, []);

  // Load results for selected project
  const loadResults = useCallback(async (slug: string) => {
    const res = await fetch(`/api/tests/results?project=${encodeURIComponent(slug)}`);
    if (res.ok) {
      const data = await res.json();
      setResults(data.results ?? []);
    }
  }, []);

  // Load env vars for selected project
  const loadEnvVars = useCallback(async (slug: string) => {
    const res = await fetch(`/api/tests/env?project=${encodeURIComponent(slug)}`);
    if (res.ok) setEnvVars(await res.json());
    else setEnvVars({});
  }, []);

  // Save env vars
  const saveEnvVars = useCallback(async (vars: Record<string, string>, slug: string) => {
    setEnvSaving(true);
    await fetch(`/api/tests/env?project=${encodeURIComponent(slug)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(vars),
    });
    setEnvSaving(false);
  }, []);

  // Poll run status
  const pollRunStatus = useCallback(async (slug: string) => {
    const res = await fetch(`/api/tests/run?project=${encodeURIComponent(slug)}`);
    if (res.ok) {
      const data = await res.json();
      if (!data.running) {
        setRunning(false);
        if (pollRef.current) clearInterval(pollRef.current);
        loadResults(slug);
      }
    }
  }, [loadResults]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (!selectedProject) return;
    loadConfig(selectedProject);
    loadResults(selectedProject);
    loadEnvVars(selectedProject);
    setEditingCase(null);
    setShowNewForm(false);
    // Re-attach polling if a run is already in progress (survives page refresh)
    fetch(`/api/tests/run?project=${encodeURIComponent(selectedProject)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.running) {
          setRunning(true);
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = setInterval(() => pollRunStatus(selectedProject), 5000);
        }
      })
      .catch(() => {});
  }, [selectedProject, loadConfig, loadResults, loadEnvVars, pollRunStatus]);

  // Save config to server
  const saveConfig = useCallback(async (updated: TestConfig) => {
    if (!selectedProject) return;
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch(`/api/tests/cases?project=${encodeURIComponent(selectedProject)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (!res.ok) setSaveError("Failed to save");
    } catch {
      setSaveError("Network error");
    } finally {
      setSaving(false);
    }
  }, [selectedProject]);

  const handleAddCase = (tc: TestCase) => {
    if (!config) return;
    const updated = { ...config, test_cases: [...config.test_cases, tc] };
    setConfig(updated);
    saveConfig(updated);
    setShowNewForm(false);
  };

  const handleEditCase = (tc: TestCase) => {
    if (!config) return;
    const updated = {
      ...config,
      test_cases: config.test_cases.map((c) => (c.id === tc.id ? tc : c)),
    };
    setConfig(updated);
    saveConfig(updated);
    setEditingCase(null);
  };

  const handleDeleteCase = (id: string) => {
    if (!config) return;
    const updated = { ...config, test_cases: config.test_cases.filter((c) => c.id !== id) };
    setConfig(updated);
    saveConfig(updated);
  };

  const handleToggleEnabled = (id: string) => {
    if (!config) return;
    const updated = {
      ...config,
      test_cases: config.test_cases.map((c) =>
        c.id === id ? { ...c, enabled: !c.enabled } : c
      ),
    };
    setConfig(updated);
    saveConfig(updated);
  };

  const handleMoveCase = (index: number, direction: -1 | 1) => {
    if (!config) return;
    const cases = [...config.test_cases];
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= cases.length) return;
    [cases[index], cases[newIndex]] = [cases[newIndex], cases[index]];
    const updated = { ...config, test_cases: cases };
    setConfig(updated);
    saveConfig(updated);
  };

  const handleRun = async () => {
    if (!selectedProject || running) return;
    setRunError("");
    setRunning(true);

    const res = await fetch(`/api/tests/run?project=${encodeURIComponent(selectedProject)}`, {
      method: "POST",
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setRunError(data.error ?? "Failed to start tests");
      setRunning(false);
      return;
    }

    // Poll every 5s
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => pollRunStatus(selectedProject), 5000);
  };

  const handleCreateProject = async () => {
    const slug = slugify(newProjectSlug);
    if (!slug) return;
    const newConfig: TestConfig = {
      project: slug,
      description: newProjectSlug,
      test_cases: [],
    };
    await fetch(`/api/tests/cases?project=${encodeURIComponent(slug)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newConfig),
    });
    await loadProjects();
    setSelectedProject(slug);
    setNewProjectSlug("");
    setShowNewProject(false);
  };

  const allCaseIds = config?.test_cases.map((c) => c.id) ?? [];

  return (
    <div className="max-w-screen-xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #a855f7 0%, #6366f1 100%)" }}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: "#e2e8f0" }}>
              uwu-tester
            </h1>
            <p className="text-xs" style={{ color: "#4a5568" }}>
              browser-use regression tests
            </p>
          </div>
        </div>

        <a
          href="/"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium"
          style={BTN(true, "#94a3b8")}
        >
          ← Dashboard
        </a>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: Project selector */}
        <div className="lg:col-span-1 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#4a5568" }}>
              Projects
            </span>
            <button
              onClick={() => setShowNewProject((v) => !v)}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs"
              style={BTN(true, "#00d4ff")}
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New
            </button>
          </div>

          {showNewProject && (
            <div className="flex gap-2">
              <input
                className="flex-1 px-3 py-1.5 rounded text-xs outline-none"
                style={INPUT_STYLE}
                value={newProjectSlug}
                onChange={(e) => setNewProjectSlug(e.target.value)}
                placeholder="project-name"
                onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
                onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(0,212,255,0.4)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(30,45,74,0.8)")}
                autoFocus
              />
              <button
                onClick={handleCreateProject}
                className="px-3 py-1.5 rounded text-xs font-medium"
                style={BTN(!!newProjectSlug.trim(), "#00ff88")}
              >
                Create
              </button>
            </div>
          )}

          {projects.length === 0 ? (
            <div className="text-xs py-6 text-center" style={{ color: "#4a5568" }}>
              No projects yet. Create one above.
            </div>
          ) : (
            <div className="space-y-1">
              {projects.map((slug) => (
                <button
                  key={slug}
                  onClick={() => setSelectedProject(slug)}
                  className="w-full text-left px-3 py-2.5 rounded text-sm font-mono transition-all"
                  style={{
                    background:
                      selectedProject === slug
                        ? "rgba(168,85,247,0.12)"
                        : "rgba(30,45,74,0.3)",
                    border: `1px solid ${
                      selectedProject === slug
                        ? "rgba(168,85,247,0.3)"
                        : "rgba(30,45,74,0.5)"
                    }`,
                    color: selectedProject === slug ? "#a855f7" : "#94a3b8",
                  }}
                >
                  {slug}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT: Test cases + results */}
        <div className="lg:col-span-2 space-y-6">
          {!selectedProject ? (
            <div className="card flex items-center justify-center py-16" style={{ color: "#4a5568" }}>
              Select or create a project
            </div>
          ) : (
            <>
              {/* ── Test Cases ── */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#4a5568" }}>
                      Test Cases
                    </span>
                    <span
                      className="badge"
                      style={{
                        background: "rgba(168,85,247,0.1)",
                        color: "#a855f7",
                        border: "1px solid rgba(168,85,247,0.2)",
                      }}
                    >
                      {config?.test_cases.length ?? 0}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {saveError && (
                      <span className="text-xs" style={{ color: "#ff4444" }}>
                        {saveError}
                      </span>
                    )}
                    {saving && (
                      <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="#4a5568" strokeWidth="2">
                        <path d="M21 12a9 9 0 1 1-9-9" />
                      </svg>
                    )}
                    <button
                      onClick={() => { setShowNewForm(true); setEditingCase(null); }}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium"
                      style={BTN(true, "#00d4ff")}
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      Add Case
                    </button>

                    <button
                      onClick={handleRun}
                      disabled={running}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium"
                      style={BTN(!running, "#00ff88")}
                    >
                      {running ? (
                        <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 12a9 9 0 1 1-9-9" />
                        </svg>
                      ) : (
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      )}
                      {running ? "Running…" : "Test via API"}
                    </button>

                    <button
                      onClick={() => setMcpModal("claude")}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium"
                      style={BTN(true, "#f97316")}
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 9h8M8 13h5" />
                      </svg>
                      Test via Claude Code
                    </button>

                    <button
                      onClick={() => setMcpModal("opencode")}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium"
                      style={BTN(true, "#a855f7")}
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" />
                      </svg>
                      Test via Opencode
                    </button>
                  </div>
                </div>

                {runError && (
                  <div className="text-xs px-2 py-1 rounded" style={{ background: "rgba(255,68,68,0.1)", color: "#ff4444", border: "1px solid rgba(255,68,68,0.2)" }}>
                    {runError}
                  </div>
                )}

                {running && (
                  <div className="text-xs px-3 py-2 rounded flex items-center gap-2" style={{ background: "rgba(0,255,136,0.05)", border: "1px solid rgba(0,255,136,0.15)", color: "#00ff88" }}>
                    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12a9 9 0 1 1-9-9" />
                    </svg>
                    Tests running in background — results will appear below when complete.
                  </div>
                )}

                {/* New case form */}
                {showNewForm && !editingCase && (
                  <CaseEditor
                    initial={{}}
                    allCaseIds={allCaseIds}
                    onSave={handleAddCase}
                    onCancel={() => setShowNewForm(false)}
                  />
                )}

                {/* Case list */}
                {config && config.test_cases.length === 0 && !showNewForm ? (
                  <div className="card flex flex-col items-center justify-center py-10 gap-2" style={{ color: "#4a5568" }}>
                    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <polyline points="9 11 12 14 22 4" />
                      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                    </svg>
                    <span className="text-sm">No test cases yet</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {config?.test_cases.map((tc, i) =>
                      editingCase?.id === tc.id ? (
                        <CaseEditor
                          key={tc.id}
                          initial={tc}
                          allCaseIds={allCaseIds}
                          onSave={handleEditCase}
                          onCancel={() => setEditingCase(null)}
                        />
                      ) : (
                        <div
                          key={tc.id}
                          className="flex items-start gap-3 px-3 py-2.5 rounded"
                          style={{
                            background: tc.enabled ? "rgba(30,45,74,0.3)" : "rgba(10,14,26,0.4)",
                            border: `1px solid ${tc.enabled ? "rgba(30,45,74,0.5)" : "rgba(30,45,74,0.3)"}`,
                          }}
                        >
                          {/* Enable toggle */}
                          <button
                            onClick={() => handleToggleEnabled(tc.id)}
                            className="mt-0.5 flex-shrink-0 w-4 h-4 rounded flex items-center justify-center transition-all"
                            style={{
                              background: tc.enabled ? "rgba(0,255,136,0.15)" : "rgba(30,45,74,0.5)",
                              border: `1px solid ${tc.enabled ? "rgba(0,255,136,0.3)" : "rgba(30,45,74,0.8)"}`,
                            }}
                            title={tc.enabled ? "Disable" : "Enable"}
                          >
                            {tc.enabled && (
                              <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="#00ff88" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </button>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium" style={{ color: tc.enabled ? "#e2e8f0" : "#4a5568" }}>
                                {tc.label}
                              </span>
                              <span className="font-mono text-xs badge" style={{ background: "rgba(30,45,74,0.6)", color: "#94a3b8", border: "none" }}>
                                {tc.id}
                              </span>
                              {tc.depends_on && (
                                <span className="text-xs" style={{ color: "#4a5568" }}>
                                  → {tc.depends_on}
                                </span>
                              )}
                            </div>
                            <p
                              className="text-xs font-mono mt-0.5 line-clamp-2"
                              style={{ color: "#4a5568" }}
                            >
                              {tc.task}
                            </p>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => handleMoveCase(i, -1)}
                              disabled={i === 0}
                              className="w-6 h-6 flex items-center justify-center rounded"
                              style={BTN(i !== 0, "#94a3b8")}
                              title="Move up"
                            >
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                <polyline points="18 15 12 9 6 15" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleMoveCase(i, 1)}
                              disabled={i === (config?.test_cases.length ?? 0) - 1}
                              className="w-6 h-6 flex items-center justify-center rounded"
                              style={BTN(i !== (config?.test_cases.length ?? 0) - 1, "#94a3b8")}
                              title="Move down"
                            >
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                <polyline points="6 9 12 15 18 9" />
                              </svg>
                            </button>
                            <button
                              onClick={() => { setEditingCase(tc); setShowNewForm(false); }}
                              className="w-6 h-6 flex items-center justify-center rounded"
                              style={BTN(true, "#00d4ff")}
                              title="Edit"
                            >
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => {
                                if (confirm(`Delete test case "${tc.label}"?`)) handleDeleteCase(tc.id);
                              }}
                              className="w-6 h-6 flex items-center justify-center rounded"
                              style={BTN(true, "#ff4444")}
                              title="Delete"
                            >
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>

              {/* ── Env Vars ── */}
              {(() => {
                const vars = config ? extractVars(config.test_cases) : [];
                if (vars.length === 0) return null;
                return (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#4a5568" }}>
                        Test Variables
                      </span>
                      {envSaving && (
                        <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="#4a5568" strokeWidth="2">
                          <path d="M21 12a9 9 0 1 1-9-9" />
                        </svg>
                      )}
                    </div>
                    <div
                      className="rounded p-3 space-y-2"
                      style={{ background: "rgba(10,14,26,0.6)", border: "1px solid rgba(30,45,74,0.6)" }}
                    >
                      <p className="text-xs" style={{ color: "#4a5568" }}>
                        Placeholders detected in test prompts — values saved per project.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {vars.map((key) => (
                          <div key={key} className="space-y-0.5">
                            <label className="text-xs font-mono" style={{ color: "#94a3b8" }}>
                              {`{{${key}}}`}
                            </label>
                            <input
                              type={isSensitive(key) ? "password" : "text"}
                              className="w-full px-2.5 py-1.5 rounded text-xs outline-none font-mono"
                              style={INPUT_STYLE}
                              value={envVars[key] ?? ""}
                              onChange={(e) => setEnvVars((prev) => ({ ...prev, [key]: e.target.value }))}
                              onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(30,45,74,0.8)"; if (selectedProject) saveEnvVars({ ...envVars }, selectedProject); }}
                              onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(168,85,247,0.4)")}
                              placeholder={isSensitive(key) ? "••••••••" : "value…"}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── Results ── */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#4a5568" }}>
                    Recent Runs
                  </span>
                  <button
                    onClick={() => loadResults(selectedProject)}
                    className="text-xs px-2 py-1 rounded"
                    style={BTN(true, "#94a3b8")}
                  >
                    Refresh
                  </button>
                </div>

                {results.length === 0 ? (
                  <div className="card flex items-center justify-center py-10 text-xs" style={{ color: "#4a5568" }}>
                    No runs yet — click &quot;Test via API&quot; to start
                  </div>
                ) : (
                  <div className="space-y-2">
                    {results.map((run, i) => (
                      <RunResultCard key={run.run_id} run={run} defaultOpen={i === 0} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {mcpModal && selectedProject && (
        <McpModal
          target={mcpModal}
          project={selectedProject}
          onClose={() => setMcpModal(null)}
        />
      )}
    </div>
  );
}
