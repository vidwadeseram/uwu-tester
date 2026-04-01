"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ─── MCP Modal ────────────────────────────────────────────────────────────────

type McpTarget = "claude" | "opencode" | "api";

type RunSelectionMode = "all" | "workflows" | "cases";

function McpModal({
  target,
  project,
  runMode,
  selectedWorkflowIds,
  selectedCaseIds,
  onBackgroundStarted,
  onClose,
}: {
  target: McpTarget;
  project: string;
  runMode: RunSelectionMode;
  selectedWorkflowIds: string[];
  selectedCaseIds: string[];
  onBackgroundStarted: (input: { target: McpTarget; runId: string; project: string }) => void;
  onClose: () => void;
}) {
  const [regressionDir, setRegressionDir] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoError, setAutoError] = useState("");
  const [autoInfo, setAutoInfo] = useState("");

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

  const scopeInstruction =
    runMode === "workflows" && selectedWorkflowIds.length > 0
      ? `Run only workflows: ${selectedWorkflowIds.join(", ")}. Include required dependencies.`
      : runMode === "cases" && selectedCaseIds.length > 0
      ? `Run only case IDs: ${selectedCaseIds.join(", ")}. Include required dependencies.`
      : runMode === "workflows"
      ? "No workflows selected. Return an error without executing tests."
      : runMode === "cases"
      ? "No case IDs selected. Return an error without executing tests."
      : "Run all enabled test cases.";

  const opencodeMcpContent = JSON.stringify(
    {
      permission: "allow",
      mcp: {
        "uwu-code": {
          type: "local",
          command: ["/usr/local/bin/uwu-mcp"],
          enabled: true,
        },
      },
    },
    null,
    2
  );

  // Step 2: one-time setup — register MCP server in uwu's claude config
  const claudeWriteConfig = `sudo -u uwu bash -c 'cd /home/uwu && claude mcp add uwu-code -- /usr/local/bin/uwu-mcp'`;
  const opencodeWriteConfig = `sudo mkdir -p /home/uwu/.config/opencode\nsudo tee /home/uwu/.config/opencode/config.json << 'MCPEOF'\n${opencodeMcpContent}\nMCPEOF`;

  // Claude Code prompt: Claude IS the browser agent — no external LLM needed.
  const claudePrompt = `Read the test cases for the '${project}' project from the uwu-code MCP resource uwu://projects/${project}/cases. ${scopeInstruction} For each selected test case, YOU execute it as a browser agent: use Bash with headless playwright (python at /opt/vps-dashboard/regression_tests/.venv/bin/python) to navigate the app and verify the outcome. Do NOT call any run_tests tool. Capture recording artifacts for each case under results/${project}/recordings/manual/<run_id>/<case_id> and include recording paths in saved results. After all cases are done, call the save_results MCP tool to persist results, then give me a detailed pass/fail report with what you observed.`;

  // Opencode prompt: same self-executing approach
  const opencodePrompt = `Read the test cases for the '${project}' project from the uwu-code MCP resource uwu://projects/${project}/cases. ${scopeInstruction} For each selected test case, YOU execute it as a browser agent: use Bash with headless playwright (python at /opt/vps-dashboard/regression_tests/.venv/bin/python) to navigate the app and verify the outcome. Do NOT call any run_tests tool and do NOT run test_runner.py. Capture recording artifacts for each case under results/${project}/recordings/manual/<run_id>/<case_id> and include recording paths in saved results. After all cases are done, call the save_results MCP tool to persist results, then give me a detailed pass/fail report with what you observed.`;

  // Must cd /home/uwu so Claude uses the project scope where the MCP server is registered.
  // Run as uwu (non-root) so --dangerously-skip-permissions is accepted.
  const claudeCmd = `sudo -u uwu bash -c 'cd /home/uwu && claude --dangerously-skip-permissions -p "${claudePrompt}"'`;
  const opencodeCmd = `sudo -u uwu opencode run --dir ${dir} "${opencodePrompt}"`;

  const isClaudeCode = target === "claude";
  const isApi = target === "api";
  const accent = isClaudeCode ? "#f97316" : isApi ? "#00ff88" : "#a855f7";
  const title = isClaudeCode ? "Test via Claude Code" : isApi ? "Test via API" : "Test via Opencode";
  const icon = isClaudeCode ? (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 12h8M12 8v8" />
    </svg>
  ) : isApi ? (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  ) : (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" />
    </svg>
  );

  const configBlock = isClaudeCode
    ? claudeWriteConfig
    : isApi
    ? "No MCP setup required for API mode"
    : opencodeWriteConfig;
  const configKey = isClaudeCode
    ? "Run once to register the MCP server"
    : isApi
    ? "Optional"
    : "Run once to create opencode config";
  const cmdKey = isClaudeCode ? "Run in terminal (as root)" : "Run in terminal (as root)";
  const cmd = isClaudeCode
    ? claudeCmd
    : isApi
    ? `curl -s -X POST http://127.0.0.1:${process.env.NEXT_PUBLIC_DASHBOARD_PORT ?? "3000"}/api/tests/run?project=${project}`
    : opencodeCmd;

  async function handleAutoRun() {
    if (runMode === "workflows" && selectedWorkflowIds.length === 0) {
      setAutoError("Select at least one workflow first.");
      return;
    }
    if (runMode === "cases" && selectedCaseIds.length === 0) {
      setAutoError("Select at least one case first.");
      return;
    }
    setAutoRunning(true);
    setAutoError("");
    setAutoInfo("");
    try {
      const res = isApi
        ? await fetch(`/api/tests/run?project=${encodeURIComponent(project)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workflow_ids: runMode === "workflows" ? selectedWorkflowIds : [],
              case_ids: runMode === "cases" ? selectedCaseIds : [],
            }),
          })
        : await fetch("/api/tests/agent-run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              target,
              project,
              workflow_ids: runMode === "workflows" ? selectedWorkflowIds : [],
              case_ids: runMode === "cases" ? selectedCaseIds : [],
            }),
          });
      const data = await res.json();
      if (!res.ok) {
        setAutoError(data.error ?? "Failed to start auto run");
      } else {
        const runId = String(data.run_id ?? "");
        onBackgroundStarted({ target, runId, project });
        setAutoInfo(`Started in background${runId ? ` · ${runId}` : ""}.`);
      }
    } catch {
      setAutoError("Network error while running agent");
    } finally {
      setAutoRunning(false);
    }
  }

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
          <span style={{ color: accent }}>{isClaudeCode ? "Claude Code" : isApi ? "API runner" : "Opencode"}</span>.
        </p>

        {!isApi && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold" style={{ color: accent }}>Step 1 — install MCP server deps</span>
            <CodeBlock
              text={`cd ${dir}\nuv sync`}
              copyKey="install"
              label="Run once in your terminal"
            />
          </div>
        )}

        {!isApi && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold" style={{ color: accent }}>Step 2 — add MCP server config</span>
            <CodeBlock text={configBlock} copyKey="config" label={configKey} />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold" style={{ color: accent }}>{isApi ? "Run command" : "Step 3 — run your agent"}</span>
          <CodeBlock text={cmd} copyKey="cmd" label={cmdKey} />
        </div>

        {!isApi && (
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
        )}

        <div className="flex flex-col gap-2">
          <button
            onClick={handleAutoRun}
            disabled={autoRunning}
            className="px-3 py-1.5 rounded text-xs font-medium"
            style={BTN(!autoRunning, accent)}
          >
            {autoRunning ? "Starting…" : "Auto Run (Background)"}
          </button>
          {autoError && (
            <div className="text-xs px-2 py-1 rounded" style={{ background: "rgba(255,68,68,0.1)", color: "#ff4444", border: "1px solid rgba(255,68,68,0.2)" }}>
              {autoError}
            </div>
          )}
          {autoInfo && (
            <div className="text-xs px-2 py-1 rounded" style={{ background: "rgba(0,255,136,0.1)", color: "#00ff88", border: "1px solid rgba(0,255,136,0.2)" }}>
              {autoInfo}
            </div>
          )}
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

interface Workflow {
  id: string;
  label: string;
  description?: string;
  enabled: boolean;
  case_ids: string[];
}

interface TestConfig {
  project: string;
  description: string;
  test_cases: TestCase[];
  workflows: Workflow[];
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

interface AgentRun {
  run_id: string;
  project: string;
  target: "claude" | "opencode";
  status: "running" | "completed" | "failed";
  started_at: string;
  completed_at?: string;
  workflow_ids: string[];
  case_ids: string[];
  exit_code?: number;
  summary?: string;
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

function normalizeConfig(raw: Partial<TestConfig>): TestConfig {
  const testCases = Array.isArray(raw.test_cases) ? raw.test_cases : [];
  const workflows = Array.isArray(raw.workflows) ? raw.workflows : [];
  return {
    project: raw.project ?? "",
    description: raw.description ?? "",
    test_cases: testCases,
    workflows,
  };
}

function resolveRunCaseIds(
  config: TestConfig | null,
  mode: RunSelectionMode,
  selectedWorkflowIds: string[],
  selectedCaseIds: string[]
): string[] {
  if (!config) return [];
  const caseById = new Map(config.test_cases.map((tc) => [tc.id, tc]));
  const workflowById = new Map(config.workflows.map((wf) => [wf.id, wf]));
  const requestedOrder: string[] = [];
  const requestedSet = new Set<string>();

  const pushRequested = (caseId: string) => {
    if (!caseId || requestedSet.has(caseId)) return;
    requestedSet.add(caseId);
    requestedOrder.push(caseId);
  };

  if (mode === "workflows") {
    selectedWorkflowIds.forEach((workflowId) => {
      const wf = workflowById.get(workflowId);
      if (wf) {
        wf.case_ids.forEach((caseId) => {
          pushRequested(caseId);
        });
      }
    });
  } else if (mode === "cases") {
    selectedCaseIds.forEach((caseId) => {
      pushRequested(caseId);
    });
  } else {
    config.test_cases.forEach((tc) => {
      if (tc.enabled) pushRequested(tc.id);
    });
  }

  const resolvedSet = new Set<string>();
  const orderedResolved: string[] = [];
  const walk = (caseId: string, seen: Set<string>) => {
    if (resolvedSet.has(caseId) || seen.has(caseId)) return;
    const tc = caseById.get(caseId);
    if (!tc) return;
    seen.add(caseId);
    if (tc.depends_on) walk(tc.depends_on, seen);
    seen.delete(caseId);
    if (!resolvedSet.has(caseId)) {
      resolvedSet.add(caseId);
      orderedResolved.push(caseId);
    }
  };

  requestedOrder.forEach((caseId) => {
    walk(caseId, new Set());
  });

  return orderedResolved;
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

function WorkflowEditor({
  initial,
  cases,
  onSave,
  onCancel,
}: {
  initial: Partial<Workflow>;
  cases: TestCase[];
  onSave: (wf: Workflow) => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState(initial.id ?? "");
  const [label, setLabel] = useState(initial.label ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [enabled, setEnabled] = useState(initial.enabled ?? true);
  const [caseIds, setCaseIds] = useState<string[]>(initial.case_ids ?? []);
  const [error, setError] = useState("");
  const isNew = !initial.id;

  const addCase = (caseId: string) => {
    setCaseIds((prev) => (prev.includes(caseId) ? prev : [...prev, caseId]));
  };

  const removeCase = (caseId: string) => {
    setCaseIds((prev) => prev.filter((v) => v !== caseId));
  };

  const moveCase = (index: number, direction: -1 | 1) => {
    setCaseIds((prev) => {
      const next = [...prev];
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= next.length) return prev;
      [next[index], next[newIndex]] = [next[newIndex], next[index]];
      return next;
    });
  };

  const availableCases = cases.filter((tc) => !caseIds.includes(tc.id));

  const handleSave = () => {
    if (!id.trim()) {
      setError("ID is required");
      return;
    }
    if (!label.trim()) {
      setError("Label is required");
      return;
    }
    if (caseIds.length === 0) {
      setError("Select at least one test case");
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      setError("ID must be alphanumeric / _ -");
      return;
    }
    onSave({
      id: id.trim(),
      label: label.trim(),
      description: description.trim(),
      enabled,
      case_ids: caseIds,
    });
  };

  return (
    <div
      className="rounded p-4 space-y-3"
      style={{ background: "rgba(30,45,74,0.4)", border: "1px solid rgba(168,85,247,0.2)" }}
    >
      <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#a855f7" }}>
        {isNew ? "New Workflow" : "Edit Workflow"}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input
          className="px-3 py-1.5 rounded text-xs outline-none"
          style={INPUT_STYLE}
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            if (isNew) setId(slugify(e.target.value));
          }}
          placeholder="Full regression"
        />
        <input
          className="px-3 py-1.5 rounded text-xs font-mono outline-none"
          style={INPUT_STYLE}
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="full_regression"
          disabled={!isNew}
        />
      </div>

      <input
        className="px-3 py-1.5 rounded text-xs outline-none"
        style={INPUT_STYLE}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Optional workflow description"
      />

      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#4a5568" }}>
          Workflow order
        </div>
        <div className="space-y-1 max-h-40 overflow-y-auto p-2 rounded" style={{ background: "rgba(10,14,26,0.6)", border: "1px solid rgba(30,45,74,0.5)" }}>
          {caseIds.length === 0 ? (
            <div className="text-xs" style={{ color: "#4a5568" }}>No cases selected.</div>
          ) : (
            caseIds.map((caseId, index) => {
              const tc = cases.find((item) => item.id === caseId);
              return (
                <div key={`${caseId}-${index}`} className="flex items-center gap-2 rounded px-2 py-1" style={{ background: "rgba(30,45,74,0.35)", border: "1px solid rgba(30,45,74,0.6)" }}>
                  <span className="text-[11px] w-4 text-right" style={{ color: "#4a5568" }}>{index + 1}</span>
                  <span className="font-mono text-xs flex-1" style={{ color: "#94a3b8" }}>{caseId}</span>
                  {tc && <span className="text-[11px] hidden sm:inline" style={{ color: "#4a5568" }}>{tc.label}</span>}
                  <button onClick={() => moveCase(index, -1)} disabled={index === 0} className="w-5 h-5 rounded text-[10px]" style={BTN(index !== 0, "#94a3b8")}>↑</button>
                  <button onClick={() => moveCase(index, 1)} disabled={index === caseIds.length - 1} className="w-5 h-5 rounded text-[10px]" style={BTN(index !== caseIds.length - 1, "#94a3b8")}>↓</button>
                  <button onClick={() => removeCase(caseId)} className="w-5 h-5 rounded text-[10px]" style={BTN(true, "#ff4444")}>×</button>
                </div>
              );
            })
          )}
        </div>

        <div className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#4a5568" }}>
          Add cases
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto p-2 rounded" style={{ background: "rgba(10,14,26,0.6)", border: "1px solid rgba(30,45,74,0.5)" }}>
          {availableCases.length === 0 ? (
            <div className="text-xs" style={{ color: "#4a5568" }}>All cases already included.</div>
          ) : (
            availableCases.map((tc) => (
              <button
                key={tc.id}
                onClick={() => addCase(tc.id)}
                className="flex items-center justify-between gap-2 text-xs px-2 py-1 rounded text-left"
                style={BTN(true, "#00d4ff")}
              >
                <span className="font-mono">{tc.id}</span>
                <span className="text-[10px]">＋</span>
              </button>
            ))
          )}
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs" style={{ color: "#94a3b8" }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Enabled
      </label>

      {error && (
        <div className="text-xs px-2 py-1 rounded" style={{ background: "rgba(255,68,68,0.1)", color: "#ff4444", border: "1px solid rgba(255,68,68,0.2)" }}>
          {error}
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1.5 rounded text-xs" style={BTN(true, "#94a3b8")}>Cancel</button>
        <button onClick={handleSave} className="px-3 py-1.5 rounded text-xs font-medium" style={BTN(true, "#a855f7")}>Save</button>
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
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [dismissedRunIds, setDismissedRunIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("dismissedAgentRunIds") ?? "[]"); } catch { return []; }
  });
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [editingCase, setEditingCase] = useState<Partial<TestCase> | null>(null);
  const [editingWorkflow, setEditingWorkflow] = useState<Partial<Workflow> | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [showNewWorkflowForm, setShowNewWorkflowForm] = useState(false);
  const [newProjectSlug, setNewProjectSlug] = useState("");
  const [showNewProject, setShowNewProject] = useState(false);
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const [mcpModal, setMcpModal] = useState<McpTarget | null>(null);
  const [envSaving, setEnvSaving] = useState(false);
  const [runMode, setRunMode] = useState<RunSelectionMode>("all");
  const [selectedWorkflowIds, setSelectedWorkflowIds] = useState<string[]>([]);
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const agentRunStatusRef = useRef<Record<string, AgentRun["status"]>>({});

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
      const normalized = normalizeConfig(data);
      setConfig(normalized);
      setSelectedWorkflowIds(normalized.workflows.filter((wf) => wf.enabled).map((wf) => wf.id));
      setSelectedCaseIds(normalized.test_cases.filter((tc) => tc.enabled).map((tc) => tc.id));
      setRunMode("all");
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

  const loadAgentRuns = useCallback(async (slug: string) => {
    const res = await fetch(`/api/tests/agent-run?project=${encodeURIComponent(slug)}`);
    if (res.ok) {
      const data = await res.json();
      const nextRuns: AgentRun[] = data.runs ?? [];
      const prevStatuses = agentRunStatusRef.current;
      const nextStatuses: Record<string, AgentRun["status"]> = {};
      let shouldReloadResults = false;

      for (const run of nextRuns) {
        nextStatuses[run.run_id] = run.status;
        if (prevStatuses[run.run_id] === "running" && run.status !== "running") {
          shouldReloadResults = true;
        }
      }

      agentRunStatusRef.current = nextStatuses;
      setAgentRuns(nextRuns);

      if (shouldReloadResults) {
        loadResults(slug);
      }
    }
  }, [loadResults]);

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
    agentRunStatusRef.current = {};
    loadConfig(selectedProject);
    loadResults(selectedProject);
    loadAgentRuns(selectedProject);
    loadEnvVars(selectedProject);
    setEditingCase(null);
    setEditingWorkflow(null);
    setShowNewForm(false);
    setShowNewWorkflowForm(false);
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

    const agentPoll = setInterval(() => {
      loadAgentRuns(selectedProject);
    }, 5000);

    return () => {
      clearInterval(agentPoll);
    };
  }, [selectedProject, loadConfig, loadResults, loadAgentRuns, loadEnvVars, pollRunStatus]);

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

  const handleAddWorkflow = (wf: Workflow) => {
    if (!config) return;
    const updated = { ...config, workflows: [...config.workflows, wf] };
    setConfig(updated);
    saveConfig(updated);
    setShowNewWorkflowForm(false);
  };

  const handleEditWorkflow = (wf: Workflow) => {
    if (!config) return;
    const updated = {
      ...config,
      workflows: config.workflows.map((w) => (w.id === wf.id ? wf : w)),
    };
    setConfig(updated);
    saveConfig(updated);
    setEditingWorkflow(null);
  };

  const handleDeleteWorkflow = (id: string) => {
    if (!config) return;
    const updated = { ...config, workflows: config.workflows.filter((w) => w.id !== id) };
    setConfig(updated);
    saveConfig(updated);
    setSelectedWorkflowIds((prev) => prev.filter((wid) => wid !== id));
  };

  const handleToggleWorkflowEnabled = (id: string) => {
    if (!config) return;
    const updated = {
      ...config,
      workflows: config.workflows.map((w) =>
        w.id === id ? { ...w, enabled: !w.enabled } : w
      ),
    };
    setConfig(updated);
    saveConfig(updated);
  };

  const openWorkflowRun = (target: McpTarget, workflowId: string) => {
    setRunMode("workflows");
    setSelectedWorkflowIds([workflowId]);
    setMcpModal(target);
  };

  const handleCreateProject = async () => {
    const slug = slugify(newProjectSlug);
    if (!slug) return;
    const newConfig: TestConfig = {
      project: slug,
      description: newProjectSlug,
      test_cases: [],
      workflows: [],
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
  const resolvedRunCaseIds = resolveRunCaseIds(config, runMode, selectedWorkflowIds, selectedCaseIds);
  const visibleAgentRuns = agentRuns.filter((run) => !dismissedRunIds.includes(run.run_id));
  const runningAgentRuns = visibleAgentRuns.filter((run) => run.status === "running");
  const recentFinishedAgentRuns = visibleAgentRuns
    .filter((run) => run.status !== "running")
    .slice(0, 3);

  const handleBackgroundStarted = useCallback(
    ({ target, runId, project }: { target: McpTarget; runId: string; project: string }) => {
      if (project !== selectedProject) return;

      if ((target === "claude" || target === "opencode") && runId) {
        const startedAt = new Date().toISOString();
        agentRunStatusRef.current = { ...agentRunStatusRef.current, [runId]: "running" };
        setAgentRuns((prev) => {
          if (prev.some((run) => run.run_id === runId)) return prev;
          return [
            {
              run_id: runId,
              project,
              target,
              status: "running",
              started_at: startedAt,
              workflow_ids: [],
              case_ids: [],
            },
            ...prev,
          ];
        });
      }

      if (target === "api") {
        setRunning(true);
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(() => pollRunStatus(project), 5000);
      }
      loadAgentRuns(project);
    },
    [selectedProject, pollRunStatus, loadAgentRuns]
  );

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
              uwu-code
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

      {(running || runningAgentRuns.length > 0 || recentFinishedAgentRuns.length > 0) && (
        <div className="fixed top-[60px] right-4 z-50 w-full max-w-sm">
          <div
            className="rounded-lg p-3 space-y-2"
            style={{
              background: "rgba(10,14,26,0.95)",
              border: "1px solid rgba(0,212,255,0.25)",
              boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
            }}
          >
            <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#00d4ff" }}>
              Background Runs
            </div>

            {running && selectedProject && (
              <div className="flex items-center gap-2 text-xs" style={{ color: "#00ff88" }}>
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-9-9" />
                </svg>
                <span className="font-mono">API · {selectedProject}</span>
              </div>
            )}

            {runningAgentRuns.map((run) => (
              <div key={run.run_id} className="rounded px-2 py-1.5" style={{ background: "rgba(30,45,74,0.45)", border: "1px solid rgba(30,45,74,0.7)" }}>
                <div className="flex items-center gap-2 text-xs" style={{ color: run.target === "claude" ? "#f97316" : "#a855f7" }}>
                  <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-9-9" />
                  </svg>
                  <span className="font-mono">{run.target} · {run.project}</span>
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: "#94a3b8" }}>
                  started {formatTime(run.started_at)}
                </div>
              </div>
            ))}

            {recentFinishedAgentRuns.map((run) => (
              <div key={run.run_id} className="rounded px-2 py-1.5" style={{ background: run.status === "completed" ? "rgba(0,255,136,0.08)" : "rgba(255,68,68,0.08)", border: `1px solid ${run.status === "completed" ? "rgba(0,255,136,0.3)" : "rgba(255,68,68,0.3)"}` }}>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span style={{ color: run.status === "completed" ? "#00ff88" : "#ff4444" }} className="font-mono">
                    {run.target} · {run.project} · {run.status}
                  </span>
                  <button
                    onClick={() => setDismissedRunIds((prev) => {
                      const next = prev.includes(run.run_id) ? prev : [...prev, run.run_id];
                      try { localStorage.setItem("dismissedAgentRunIds", JSON.stringify(next)); } catch {}
                      return next;
                    })}
                    className="w-5 h-5 rounded text-[10px]"
                    style={BTN(true, "#94a3b8")}
                    title="Dismiss"
                  >
                    ✕
                  </button>
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: "#94a3b8" }}>
                  started {formatTime(run.started_at)}
                </div>
                {run.status === "failed" && run.summary && (
                  <pre className="text-[10px] mt-1 rounded p-1 overflow-x-auto whitespace-pre-wrap break-all" style={{ background: "rgba(0,0,0,0.3)", color: "#f87171", maxHeight: "8rem" }}>
                    {run.summary.slice(-800)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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
              <div className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#4a5568" }}>
                  Run Scope
                </span>
                <div className="grid sm:grid-cols-3 gap-2">
                  <button onClick={() => setRunMode("all")} className="px-3 py-1.5 rounded text-xs" style={BTN(runMode === "all", "#00ff88")}>All enabled cases</button>
                  <button onClick={() => setRunMode("workflows")} className="px-3 py-1.5 rounded text-xs" style={BTN(runMode === "workflows", "#a855f7")}>Selected workflows</button>
                  <button onClick={() => setRunMode("cases")} className="px-3 py-1.5 rounded text-xs" style={BTN(runMode === "cases", "#00d4ff")}>Selected cases</button>
                </div>

                {runMode === "workflows" && config && (
                  <div className="flex flex-wrap gap-2">
                    {config.workflows.map((wf) => (
                      <button
                        key={wf.id}
                        onClick={() =>
                          setSelectedWorkflowIds((prev) =>
                            prev.includes(wf.id) ? prev.filter((v) => v !== wf.id) : [...prev, wf.id]
                          )
                        }
                        className="px-2 py-1 rounded text-xs font-mono"
                        style={BTN(selectedWorkflowIds.includes(wf.id), "#a855f7")}
                      >
                        {wf.id}
                      </button>
                    ))}
                  </div>
                )}

                {runMode === "cases" && config && (
                  <div className="flex flex-wrap gap-2">
                    {config.test_cases.map((tc) => (
                      <button
                        key={tc.id}
                        onClick={() =>
                          setSelectedCaseIds((prev) =>
                            prev.includes(tc.id) ? prev.filter((v) => v !== tc.id) : [...prev, tc.id]
                          )
                        }
                        className="px-2 py-1 rounded text-xs font-mono"
                        style={BTN(selectedCaseIds.includes(tc.id), "#00d4ff")}
                      >
                        {tc.id}
                      </button>
                    ))}
                  </div>
                )}

                <p className="text-xs" style={{ color: "#4a5568" }}>
                  Effective run order: {resolvedRunCaseIds.length > 0 ? resolvedRunCaseIds.join(" → ") : "None selected"}
                </p>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setMcpModal("api")}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium"
                    style={BTN(true, "#00ff88")}
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                    Test via API
                  </button>
                  <button
                    onClick={() => setMcpModal("claude")}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium"
                    style={BTN(true, "#f97316")}
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 9h8M8 13h5" /></svg>
                    Test via Claude Code
                  </button>
                  <button
                    onClick={() => setMcpModal("opencode")}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium"
                    style={BTN(true, "#a855f7")}
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>
                    Test via Opencode
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#4a5568" }}>
                      Workflows
                    </span>
                    <span className="badge" style={{ background: "rgba(168,85,247,0.1)", color: "#a855f7", border: "1px solid rgba(168,85,247,0.2)" }}>
                      {config?.workflows.length ?? 0}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setShowNewWorkflowForm(true);
                      setEditingWorkflow(null);
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium"
                    style={BTN(true, "#a855f7")}
                  >
                    + Add Workflow
                  </button>
                </div>

                {showNewWorkflowForm && !editingWorkflow && config && (
                  <WorkflowEditor
                    initial={{}}
                    cases={config.test_cases}
                    onSave={handleAddWorkflow}
                    onCancel={() => setShowNewWorkflowForm(false)}
                  />
                )}

                {config && config.workflows.length > 0 && (
                  <div className="space-y-2">
                    {config.workflows.map((wf) =>
                      editingWorkflow?.id === wf.id ? (
                        <WorkflowEditor
                          key={wf.id}
                          initial={wf}
                          cases={config.test_cases}
                          onSave={handleEditWorkflow}
                          onCancel={() => setEditingWorkflow(null)}
                        />
                      ) : (
                        <div key={wf.id} className="flex items-start gap-3 px-3 py-2.5 rounded" style={{ background: "rgba(30,45,74,0.3)", border: "1px solid rgba(30,45,74,0.5)" }}>
                          <button
                            onClick={() => handleToggleWorkflowEnabled(wf.id)}
                            className="mt-0.5 flex-shrink-0 w-4 h-4 rounded flex items-center justify-center"
                            style={{
                              background: wf.enabled ? "rgba(0,255,136,0.15)" : "rgba(30,45,74,0.5)",
                              border: `1px solid ${wf.enabled ? "rgba(0,255,136,0.3)" : "rgba(30,45,74,0.8)"}`,
                            }}
                          >
                            {wf.enabled && <span className="text-[10px]" style={{ color: "#00ff88" }}>✓</span>}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium" style={{ color: "#e2e8f0" }}>{wf.label}</span>
                              <span className="font-mono text-xs badge" style={{ background: "rgba(30,45,74,0.6)", color: "#94a3b8", border: "none" }}>{wf.id}</span>
                              <span className="text-xs" style={{ color: "#4a5568" }}>{wf.case_ids.length} cases</span>
                            </div>
                            {wf.description && <p className="text-xs mt-0.5" style={{ color: "#4a5568" }}>{wf.description}</p>}
                            <p className="text-[11px] mt-1 font-mono break-words" style={{ color: "#64748b" }}>
                              {wf.case_ids.join(" → ")}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 flex-wrap justify-end flex-shrink-0">
                            <button
                              onClick={() => openWorkflowRun("api", wf.id)}
                              className="px-2 py-1 rounded text-[11px] whitespace-nowrap"
                              style={BTN(true, "#00ff88")}
                            >
                              Test via API
                            </button>
                            <button
                              onClick={() => openWorkflowRun("claude", wf.id)}
                              className="px-2 py-1 rounded text-[11px] whitespace-nowrap"
                              style={BTN(true, "#f97316")}
                            >
                              Test via Claude Code
                            </button>
                            <button
                              onClick={() => openWorkflowRun("opencode", wf.id)}
                              className="px-2 py-1 rounded text-[11px] whitespace-nowrap"
                              style={BTN(true, "#a855f7")}
                            >
                              Test via Opencode
                            </button>
                            <button
                              onClick={() => setEditingWorkflow(wf)}
                              className="px-2 py-1 rounded text-xs"
                              style={BTN(true, "#a855f7")}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => {
                                if (confirm(`Delete workflow \"${wf.label}\"?`)) handleDeleteWorkflow(wf.id);
                              }}
                              className="w-6 h-6 rounded"
                              style={BTN(true, "#ff4444")}
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>

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

                  </div>
                </div>

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
                    No runs yet — run tests via API, Claude Code, or OpenCode to start
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
          runMode={runMode}
          selectedWorkflowIds={selectedWorkflowIds}
          selectedCaseIds={resolvedRunCaseIds}
          onBackgroundStarted={handleBackgroundStarted}
          onClose={() => setMcpModal(null)}
        />
      )}
    </div>
  );
}
