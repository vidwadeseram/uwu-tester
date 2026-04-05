"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import "xterm/css/xterm.css";

interface Session {
  id: string;
  tmuxSession: string;
}

export default function TerminalPage() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<any>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setXtermLoaded] = useState(false);

  useEffect(() => {
    const loadXterm = async () => {
      const Terminal = (await import("xterm")).Terminal;
      const FitAddon = (await import("@xterm/addon-fit")).FitAddon;
      const WebLinksAddon = (await import("@xterm/addon-web-links")).WebLinksAddon;

      if (!terminalRef.current || terminalInstance.current) return;

      const isMobile = window.innerWidth < 640;
      const term = new Terminal({
        fontSize: isMobile ? 12 : 14,
        fontFamily: "Menlo, Monaco, 'Courier New', monospace",
        cursorBlink: true,
        scrollback: 1000,
        theme: {
          background: "#1e1e1e",
          foreground: "#d4d4d4",
        },
      });

      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon());

      term.open(terminalRef.current);
      fit.fit();

      terminalInstance.current = { term, fit };

      term.writeln("Terminal session initialized");
      term.writeln("");
      term.writeln("For full terminal functionality, the server needs to be configured with:");
      term.writeln("1. A WebSocket terminal relay service");
      term.writeln("2. Or ttyd with per-session tmux windows");
      term.writeln("");
      term.writeln("Use the 'Open Full Terminal' button below to access the terminal.");

      setXtermLoaded(true);

      const handleResize = () => {
        if (terminalInstance.current?.fit) {
          terminalInstance.current.fit.fit();
        }
      };
      window.addEventListener("resize", handleResize);

      return () => {
        window.removeEventListener("resize", handleResize);
      };
    };

    loadXterm();

    return () => {
      if (terminalInstance.current?.term) {
        terminalInstance.current.term.dispose();
      }
    };
  }, []);

  const initSession = useCallback(async () => {
    try {
      const res = await fetch("/api/terminal/sessions", { method: "POST" });
      const data = await res.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      setSession({ id: data.id, tmuxSession: data.tmuxSession });
    } catch {
      setError("Failed to create session");
    }
  }, []);

  useEffect(() => {
    initSession();
  }, [initSession]);

  const createNewTab = async () => {
    try {
      const res = await fetch("/api/terminal/sessions", { method: "POST" });
      const data = await res.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      setSession({ id: data.id, tmuxSession: data.tmuxSession });
    } catch {
      setError("Failed to create new tab");
    }
  };

  const closeSession = async () => {
    if (!session) return;

    try {
      await fetch(`/api/terminal/sessions/${session.id}`, { method: "DELETE" });
      setSession(null);
    } catch {
      setError("Failed to close session");
    }
  };

  const openFullTerminal = () => {
    window.open("/terminal/", "_blank");
  };

  return (
    <div className="flex flex-col fade-in -mt-14" style={{ height: "100dvh", background: "#1e1e1e" }}>
      <div className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between shrink-0" style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm truncate" style={{ color: "var(--text)" }}>
            Terminal {session ? `(${session.tmuxSession})` : ""}
          </span>
          {session ? (
            <span className="shrink-0 text-xs px-2 py-0.5 rounded bg-green-600 text-white">
              Active
            </span>
          ) : (
            <span className="shrink-0 flex items-center gap-1.5 text-xs px-2 py-0.5 rounded bg-yellow-600 text-white">
              <span
                className="spinner w-2.5 h-2.5 inline-block"
                style={{
                  border: "1.5px solid rgba(255,255,255,0.3)",
                  borderTopColor: "#fff",
                }}
              />
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={createNewTab}
            className="flex-1 sm:flex-none px-3 py-1.5 text-sm bg-primary hover:bg-primary/90 text-white rounded"
          >
            New Tab
          </button>
          <button
            type="button"
            onClick={openFullTerminal}
            className="flex-1 sm:flex-none px-3 py-1.5 text-sm rounded whitespace-nowrap"
            style={{ background: "var(--btn-bg)", color: "var(--text)", border: "1px solid var(--border)" }}
          >
            <span className="hidden sm:inline">Open Full Terminal</span>
            <span className="sm:hidden">Full</span>
          </button>
          <button
            type="button"
            onClick={closeSession}
            className="flex-1 sm:flex-none px-3 py-1.5 text-sm bg-destructive text-white rounded hover:bg-destructive/90"
          >
            Close
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 bg-destructive text-white text-sm">{error}</div>
      )}

      <div ref={terminalRef} className="flex-1 overflow-hidden" />
    </div>
  );
}
