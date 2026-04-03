"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuthState {
  ok: boolean;
  authEnabled: boolean;
  username?: string;
}

// ── Shared input style ────────────────────────────────────────────────────────

const INPUT: React.CSSProperties = {
  background: "rgba(10,14,26,0.8)",
  border: "1px solid rgba(30,45,74,0.8)",
  color: "#e2e8f0",
  borderRadius: "6px",
  padding: "8px 12px",
  fontSize: "0.8rem",
  outline: "none",
  width: "100%",
  fontFamily: "inherit",
};

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card p-4 sm:p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2 pb-1 border-b" style={{ borderColor: "#1e2d4a" }}>
        <span style={{ color: "#00d4ff" }}>{icon}</span>
        <h2 className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

// ── API Keys section ──────────────────────────────────────────────────────────

const KEY_LABELS: Record<string, { label: string; hint: string; color: string }> = {
  OPENROUTER_API_KEY: { label: "OpenRouter API Key", hint: "sk-or-v1-…  (used by openclaw for all tasks)", color: "#a855f7" },
  ANTHROPIC_API_KEY:  { label: "Anthropic API Key",  hint: "sk-ant-…  (fallback for research)",             color: "#00d4ff" },
  OPENAI_API_KEY:     { label: "OpenAI API Key",      hint: "sk-…      (optional fallback)",                color: "#00ff88" },
};

function ApiKeysSection({ authed }: { authed: boolean }) {
  const [keys, setKeys]       = useState<Record<string, string>>({});
  const [edits, setEdits]     = useState<Record<string, string>>({});
  const [reveal, setReveal]   = useState<Record<string, boolean>>({});
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/keys");
    if (res.ok) {
      const data = await res.json();
      setKeys(data.keys);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function setEdit(k: string, v: string) {
    setEdits((prev) => ({ ...prev, [k]: v }));
  }

  async function save() {
    setSaving(true); setError(""); setSaved(false);
    // Only send keys that were actually edited (non-empty)
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(edits)) {
      if (v.trim()) payload[k] = v.trim();
    }
    if (Object.keys(payload).length === 0) { setSaving(false); return; }
    try {
      const res = await fetch("/api/settings/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setEdits({});
        setSaved(true);
        load();
        setTimeout(() => setSaved(false), 3000);
      } else {
        const d = await res.json();
        setError(d.error ?? "Save failed");
      }
    } catch {
      setError("Connection error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title="API Keys"
      icon={
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
        </svg>
      }
    >
      <p className="text-xs" style={{ color: "#4a5568" }}>
        Keys are stored in <code style={{ color: "#94a3b8" }}>settings.json</code> on the VPS. Leave a field blank to keep the current value.
      </p>

      {!authed && (
        <div className="text-xs px-3 py-2 rounded" style={{ background: "rgba(255,215,0,0.08)", color: "#ffd700", border: "1px solid rgba(255,215,0,0.2)" }}>
          Set a login password below to protect these keys.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {Object.entries(KEY_LABELS).map(([k, meta]) => (
          <div key={k} className="flex flex-col gap-1">
            <label className="text-xs font-medium" style={{ color: meta.color }}>{meta.label}</label>
            <div className="text-xs mb-0.5" style={{ color: "#2e4a7a" }}>{meta.hint}</div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type={reveal[k] ? "text" : "password"}
                placeholder={keys[k] || "Not set"}
                value={edits[k] ?? ""}
                onChange={(e) => setEdit(k, e.target.value)}
                style={{ ...INPUT, flex: 1, fontFamily: "monospace" }}
              />
              {keys[k] && (
                <button
                  onClick={() => setReveal((r) => ({ ...r, [k]: !r[k] }))}
                  className="px-2.5 py-1.5 rounded text-xs flex-shrink-0"
                  style={{ background: "rgba(30,45,74,0.5)", color: "#94a3b8", border: "1px solid rgba(30,45,74,0.8)" }}
                >
                  {reveal[k] ? "Hide" : "Reveal"}
                </button>
              )}
            </div>
            {reveal[k] && keys[k] && (
              <div className="text-xs font-mono px-2 py-1 rounded" style={{ background: "rgba(10,14,26,0.8)", color: "#94a3b8" }}>
                Current: {keys[k]}
              </div>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="text-xs px-3 py-2 rounded" style={{ background: "rgba(255,68,68,0.1)", color: "#ff4444", border: "1px solid rgba(255,68,68,0.2)" }}>
          {error}
        </div>
      )}

      {saved && (
        <div className="text-xs px-3 py-2 rounded" style={{ background: "rgba(0,255,136,0.08)", color: "#00ff88", border: "1px solid rgba(0,255,136,0.2)" }}>
          ✓ Keys saved
        </div>
      )}

      <button
        onClick={save}
        disabled={saving}
        className="self-start px-4 py-2 rounded text-sm font-semibold transition-opacity"
        style={{
          background: "rgba(0,212,255,0.12)",
          color: "#00d4ff",
          border: "1px solid rgba(0,212,255,0.3)",
          cursor: saving ? "not-allowed" : "pointer",
          opacity: saving ? 0.6 : 1,
        }}
      >
        {saving ? "Saving…" : "Save Keys"}
      </button>
    </Section>
  );
}

// ── Credentials section ───────────────────────────────────────────────────────

function CredentialsSection({ authState, onAuthChange }: { authState: AuthState; onAuthChange: () => void }) {
  const [username, setUsername]         = useState("");
  const [newPwd, setNewPwd]         = useState("");
  const [confirmPwd, setConfirmPwd]     = useState("");
  const [currentPwd, setCurrentPwd]     = useState("");
  const [saving, setSaving]             = useState(false);
  const [message, setMessage]           = useState("");
  const [error, setError]               = useState("");
  const router = useRouter();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (newPwd !== confirmPwd) { setError("Passwords don't match"); return; }
    if (newPwd.length < 6)  { setError("Password must be ≥ 6 characters"); return; }
    setSaving(true); setError(""); setMessage("");
    try {
      const res = await fetch("/api/settings/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: newPwd, currentPassword: authState.authEnabled ? currentPwd : undefined }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage("Credentials saved. Please log in again.");
        setNewPwd(""); setConfirmPwd(""); setCurrentPwd("");
        onAuthChange();
        setTimeout(() => router.push("/login"), 1500);
      } else {
        setError(data.error ?? "Save failed");
      }
    } catch {
      setError("Connection error");
    } finally {
      setSaving(false);
    }
  }

  async function disableAuth() {
    if (!confirm(`Remove login protection from the dashboard?`)) return;
    const res = await fetch("/api/settings/credentials", { method: "DELETE" });
    if (res.ok) { onAuthChange(); router.push("/"); }
  }

  return (
    <Section
      title="Dashboard Login"
      icon={
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      }
    >
      {authState.authEnabled ? (
        <div className="text-xs px-3 py-2 rounded flex items-center gap-2" style={{ background: "rgba(0,255,136,0.08)", color: "#00ff88", border: "1px solid rgba(0,255,136,0.2)" }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#00ff88" }} />
          Protected — logged in as <strong>{authState.username}</strong>
        </div>
      ) : (
        <div className="text-xs px-3 py-2 rounded" style={{ background: "rgba(255,215,0,0.08)", color: "#ffd700", border: "1px solid rgba(255,215,0,0.2)" }}>
          ⚠️ No login set — dashboard is publicly accessible. Set a password below to protect it.
        </div>
      )}

      <form onSubmit={save} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: "#4a5568" }}>New Username</label>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              placeholder={authState.username || "admin"}
              style={INPUT}
            />
          </div>
          {authState.authEnabled && (
            <div className="flex flex-col gap-1">
              <label className="text-xs" style={{ color: "#4a5568" }}>Current Password</label>
              <input
                type="password"
                autoComplete="current-password"
                value={currentPwd}
                onChange={(e) => setCurrentPwd(e.target.value)}
                required
                placeholder="Required to change"
                style={INPUT}
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: "#4a5568" }}>New Password</label>
            <input
              type="password"
              autoComplete="new-password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              required
              placeholder="≥ 6 characters"
              style={INPUT}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: "#4a5568" }}>Confirm Password</label>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              required
              placeholder="Repeat password"
              style={INPUT}
            />
          </div>
        </div>

        {error && (
          <div className="text-xs px-3 py-2 rounded" style={{ background: "rgba(255,68,68,0.1)", color: "#ff4444", border: "1px solid rgba(255,68,68,0.2)" }}>
            {error}
          </div>
        )}
        {message && (
          <div className="text-xs px-3 py-2 rounded" style={{ background: "rgba(0,255,136,0.08)", color: "#00ff88", border: "1px solid rgba(0,255,136,0.2)" }}>
            {message}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded text-sm font-semibold transition-opacity"
            style={{
              background: "rgba(0,255,136,0.12)",
              color: "#00ff88",
              border: "1px solid rgba(0,255,136,0.3)",
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Saving…" : authState.authEnabled ? "Update Credentials" : "Enable Login"}
          </button>

          {authState.authEnabled && (
            <button
              type="button"
              onClick={disableAuth}
              className="px-4 py-2 rounded text-sm transition-opacity hover:opacity-80"
              style={{ background: "rgba(255,68,68,0.08)", color: "#ff4444", border: "1px solid rgba(255,68,68,0.2)" }}
            >
              Remove Login
            </button>
          )}
        </div>
      </form>
    </Section>
  );
}

// ── Model Selector ────────────────────────────────────────────────────────────

interface ORModel {
  id: string;
  name: string;
  context_length: number;
  free: boolean;
  prompt_price_per_m: number;
}

interface AgentModelOption {
  id: string;
  name: string;
}

const DEFAULT_OPENCLAW_MODEL = "openrouter/free";

function ModelPicker({
  label,
  value,
  onChange,
  models,
  loading,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  models: ORModel[];
  loading: boolean;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = models.find((m) => m.id === value);
  const filtered = models.filter(
    (m) =>
      m.id.toLowerCase().includes(search.toLowerCase()) ||
      m.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium" style={{ color: "#94a3b8" }}>{label}</label>
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs text-left"
          style={{ ...INPUT, fontFamily: "monospace" }}
          disabled={loading}
        >
          <span className="flex items-center gap-2 min-w-0">
            {selected ? (
              <>
                <span className="truncate" style={{ color: "#e2e8f0" }}>{selected.name}</span>
                {selected.free ? (
                  <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-bold" style={{ background: "rgba(0,255,136,0.15)", color: "#00ff88", border: "1px solid rgba(0,255,136,0.3)" }}>FREE</span>
                ) : (
                  <span className="flex-shrink-0 text-xs" style={{ color: "#4a5568" }}>${selected.prompt_price_per_m}/M</span>
                )}
              </>
            ) : (
              <span style={{ color: "#4a5568" }}>{loading ? "Loading models…" : value || "Select model…"}</span>
            )}
          </span>
          <svg className="w-3 h-3 flex-shrink-0 ml-2" style={{ color: "#4a5568" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {open && (
          <div
            className="absolute z-50 left-0 right-0 mt-1 rounded-lg overflow-hidden"
            style={{ background: "#0f1629", border: "1px solid #1e2d4a", boxShadow: "0 8px 32px rgba(0,0,0,0.5)", maxHeight: "320px", display: "flex", flexDirection: "column" }}
          >
            <div className="p-2 border-b" style={{ borderColor: "#1e2d4a" }}>
              <input
                autoFocus
                type="text"
                placeholder="Search models…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-2 py-1.5 rounded text-xs outline-none"
                style={{ background: "rgba(30,45,74,0.6)", color: "#e2e8f0", border: "1px solid #1e2d4a" }}
              />
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: "260px" }}>
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-xs text-center" style={{ color: "#4a5568" }}>No models found</div>
              ) : (
                filtered.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => { onChange(m.id); setOpen(false); setSearch(""); }}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors"
                    style={{
                      background: m.id === value ? "rgba(0,212,255,0.08)" : "transparent",
                      borderLeft: m.id === value ? "2px solid #00d4ff" : "2px solid transparent",
                    }}
                    onMouseEnter={(e) => { if (m.id !== value) e.currentTarget.style.background = "rgba(30,45,74,0.5)"; }}
                    onMouseLeave={(e) => { if (m.id !== value) e.currentTarget.style.background = "transparent"; }}
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-xs font-medium truncate" style={{ color: "#e2e8f0" }}>{m.name}</span>
                      <span className="text-xs font-mono truncate" style={{ color: "#4a5568" }}>{m.id}</span>
                    </div>
                    <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                      {m.free ? (
                        <span className="px-1.5 py-0.5 rounded text-xs font-bold" style={{ background: "rgba(0,255,136,0.15)", color: "#00ff88", border: "1px solid rgba(0,255,136,0.3)" }}>FREE</span>
                      ) : (
                        <span className="text-xs" style={{ color: "#4a5568" }}>${m.prompt_price_per_m}/M</span>
                      )}
                      {m.context_length > 0 && (
                        <span className="text-xs" style={{ color: "#2e4a7a" }}>{m.context_length >= 1000 ? `${Math.round(m.context_length / 1000)}k` : m.context_length}</span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
      {selected && (
        <div className="text-xs font-mono" style={{ color: "#2e4a7a" }}>{selected.id}</div>
      )}
    </div>
  );
}

function ModelsSection() {
  const [models, setModels] = useState<ORModel[]>([]);
  const [openclawModel, setOpenclawModel] = useState(DEFAULT_OPENCLAW_MODEL);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings/models")
      .then((r) => r.json())
      .then((d) => {
        setModels(d.models ?? []);
        if (d.selected?.openclaw) setOpenclawModel(d.selected.openclaw);
        if (d.error) setError(d.error);
      })
      .catch(() => setError("Failed to load models"))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true); setError(""); setSaved(false);
    try {
      const res = await fetch("/api/settings/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openclaw: openclawModel }),
      });
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 3000); }
      else { const d = await res.json(); setError(d.error ?? "Save failed"); }
    } catch { setError("Connection error"); }
    finally { setSaving(false); }
  }

  const freeCount = models.filter((m) => m.free).length;

  return (
    <Section
      title="Model Selection"
      icon={
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a10 10 0 1 0 10 10" /><path d="M12 6v6l4 2" />
        </svg>
      }
    >
      <p className="text-xs" style={{ color: "#4a5568" }}>
        Choose which model OpenClaw uses for chat and research.
        {!loading && models.length > 0 && (
          <span> Showing <strong style={{ color: "#00ff88" }}>{freeCount} free</strong> and <strong style={{ color: "#94a3b8" }}>{models.length - freeCount} paid</strong> models.</span>
        )}
      </p>

      {error && (
        <div className="text-xs px-3 py-2 rounded" style={{ background: "rgba(255,215,0,0.08)", color: "#ffd700", border: "1px solid rgba(255,215,0,0.2)" }}>
          {error}
        </div>
      )}

      <div className="flex flex-col gap-4">
        <ModelPicker
          label="OpenClaw (research & chat)"
          value={openclawModel}
          onChange={setOpenclawModel}
          models={models}
          loading={loading}
        />
      </div>

      {saved && (
        <div className="text-xs px-3 py-2 rounded" style={{ background: "rgba(0,255,136,0.08)", color: "#00ff88", border: "1px solid rgba(0,255,136,0.2)" }}>
          ✓ Models saved
        </div>
      )}

      <button
        type="button"
        onClick={save}
        disabled={saving || loading}
        className="self-start px-4 py-2 rounded text-sm font-semibold transition-opacity"
        style={{
          background: "rgba(0,212,255,0.12)",
          color: "#00d4ff",
          border: "1px solid rgba(0,212,255,0.3)",
          cursor: saving || loading ? "not-allowed" : "pointer",
          opacity: saving || loading ? 0.6 : 1,
        }}
      >
        {saving ? "Saving…" : "Save Models"}
      </button>
    </Section>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [authState, setAuthState] = useState<AuthState>({ ok: false, authEnabled: false });
  const [loading, setLoading]     = useState(true);
  const router = useRouter();

  const checkAuth = useCallback(async () => {
    const res = await fetch("/api/auth/check");
    const data = await res.json();
    setAuthState(data);
    // If auth is enabled and not logged in, redirect to login
    if (!res.ok && data.authEnabled) {
      router.push("/login");
    }
    setLoading(false);
  }, [router]);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  if (loading) {
    return (
      <div className="max-w-screen-md mx-auto px-4 py-6">
        <div className="text-sm" style={{ color: "#4a5568" }}>Loading…</div>
      </div>
    );
  }

  return (
      <div className="max-w-screen-md mx-auto px-4 py-6 space-y-6">
        {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded flex items-center justify-center"
            style={{ background: "rgba(0,212,255,0.1)", border: "1px solid rgba(0,212,255,0.25)" }}
          >
            <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="#00d4ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: "#00d4ff" }}>Settings</h1>
            <p className="text-xs" style={{ color: "#4a5568" }}>API keys · Models · Login credentials</p>
          </div>
        </div>
        {authState.authEnabled && (
          <button
            onClick={logout}
            className="text-xs px-3 py-1.5 rounded transition-opacity hover:opacity-80"
            style={{ background: "rgba(255,68,68,0.08)", color: "#ff4444", border: "1px solid rgba(255,68,68,0.2)" }}
          >
            Sign Out
          </button>
        )}
      </div>

      <ApiKeysSection authed={authState.ok} />
      <ModelsSection />
      <CredentialsSection authState={authState} onAuthChange={checkAuth} />
    </div>
  );
}
