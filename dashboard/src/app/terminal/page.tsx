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
  const [xtermLoaded, setXtermLoaded] = useState(false);

  useEffect(() => {
    const loadXterm = async () => {
      const Terminal = (await import("xterm")).Terminal;
      const FitAddon = (await import("@xterm/addon-fit")).FitAddon;
      const WebLinksAddon = (await import("@xterm/addon-web-links")).WebLinksAddon;

      if (!terminalRef.current || terminalInstance.current) return;

      const term = new Terminal({
        fontSize: 14,
        fontFamily: "Menlo, Monaco, 'Courier New', monospace",
        cursorBlink: true,
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
    <div className="flex flex-col h-screen bg-background">
      <div className="flex items-center justify-between px-4 py-2 bg-muted border-b border-border">
        <div className="flex items-center gap-4">
          <span className="text-sm text-foreground">
            Terminal {session ? `(${session.tmuxSession})` : ""}
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded ${
              session
                ? "bg-green-600 text-white"
                : "bg-yellow-600 text-white"
            }`}
          >
            {session ? "Session Active" : "Initializing..."}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={createNewTab}
            className="px-3 py-1 text-sm bg-primary hover:bg-primary/90 text-white rounded"
          >
            New Tab
          </button>
          <button
            type="button"
            onClick={openFullTerminal}
            className="px-3 py-1 text-sm bg-muted text-white rounded hover:bg-muted/80"
          >
            Open Full Terminal
          </button>
          <button
            type="button"
            onClick={closeSession}
            className="px-3 py-1 text-sm bg-destructive text-white rounded hover:bg-destructive/90"
          >
            Close
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 bg-destructive text-white text-sm">{error}</div>
      )}

      <div ref={terminalRef} className="flex-1 p-2" />
    </div>
  );
}
