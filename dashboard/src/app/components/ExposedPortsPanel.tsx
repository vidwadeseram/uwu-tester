"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PortInfo } from "../page";

interface ExposedPort {
  port: number;
  url: string;
}

interface Props {
  ports: PortInfo[];
  onPortsChanged: () => void;
  refreshToken?: number;
}

export default function ExposedPortsPanel({ ports, onPortsChanged, refreshToken }: Props) {
  const [exposedPorts, setExposedPorts] = useState<ExposedPort[]>([]);
  const [exposedLoading, setExposedLoading] = useState(true);
  const [unexposingPort, setUnexposingPort] = useState<number | null>(null);

  const fetchExposedPorts = useCallback(async () => {
    setExposedLoading(true);
    try {
      const res = await fetch("/api/expose");
      const data = await res.json();
      setExposedPorts(data.ports ?? []);
    } catch {
      setExposedPorts([]);
    } finally {
      setExposedLoading(false);
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
    setUnexposingPort(port);
    try {
      await fetch("/api/expose", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port }),
      });
      setExposedPorts((prev) => prev.filter((e) => e.port !== port));
      onPortsChanged();
    } catch (err) {
      console.error(err);
    } finally {
      setUnexposingPort(null);
    }
  }, [onPortsChanged]);

  const listeningPortSet = useMemo(
    () => new Set(ports.map((p) => p.port)),
    [ports]
  );

  const sortedExposedPorts = useMemo(
    () => [...exposedPorts].sort((a, b) => a.port - b.port),
    [exposedPorts]
  );

  const [expanded, setExpanded] = useState(true);

  return (
    <div
      className="card overflow-hidden"
      style={{ borderLeft: "3px solid #00d4ff" }}
    >
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors hover:bg-white/5"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4"
            style={{ color: "#00d4ff" }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          <h2 className="text-sm font-semibold uppercase tracking-widest" style={{ color: "#00d4ff" }}>
            Exposed Ports
          </h2>
          <span
            className="badge"
            style={{
              background: "rgba(0, 212, 255, 0.1)",
              color: "#00d4ff",
              border: "1px solid rgba(0, 212, 255, 0.25)",
            }}
          >
            {exposedLoading ? "…" : `${sortedExposedPorts.length} active`}
          </span>
        </div>
        <svg
          className="w-4 h-4 transition-transform"
          style={{
            color: "#4a5568",
            transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
          }}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          {sortedExposedPorts.length === 0 ? (
            <div className="text-xs py-2" style={{ color: "#4a5568" }}>
              No exposed ports. Use the Expose button on a listening port to make it public.
            </div>
          ) : (
            <div className="space-y-1.5">
              {sortedExposedPorts.map((item) => {
                const matched = listeningPortSet.has(item.port);
                return (
                  <div
                    key={item.port}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded px-2 py-1.5"
                    style={{ background: "rgba(15,23,42,0.75)", border: "1px solid #1e2d4a" }}
                  >
                    <div className="min-w-0 flex items-center gap-2 flex-wrap">
                      <span
                        className="badge"
                        style={{
                          background: "rgba(0,212,255,0.12)",
                          color: "#00d4ff",
                          border: "1px solid rgba(0,212,255,0.3)",
                        }}
                      >
                        :{item.port}
                      </span>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-mono truncate"
                        style={{ color: "#94a3b8" }}
                        title={item.url}
                      >
                        {item.url}
                      </a>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{
                          background: matched ? "rgba(0,255,136,0.1)" : "rgba(255,215,0,0.1)",
                          color: matched ? "#00ff88" : "#ffd700",
                          border: `1px solid ${matched ? "rgba(0,255,136,0.25)" : "rgba(255,215,0,0.25)"}`,
                        }}
                        title={matched ? "Detected in listening ports" : "Not currently detected in listening ports"}
                      >
                        {matched ? "listening" : "rule only"}
                      </span>
                    </div>

                    <button
                      type="button"
                      className="px-2 py-0.5 rounded text-[10px] font-semibold"
                      onClick={() => void handleUnexpose(item.port)}
                      disabled={unexposingPort === item.port}
                      style={{
                        background: "rgba(255,68,68,0.12)",
                        color: unexposingPort === item.port ? "#4a5568" : "#ff6b6b",
                        border: "1px solid rgba(255,68,68,0.3)",
                      }}
                    >
                      {unexposingPort === item.port ? "Stopping…" : "Stop"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}