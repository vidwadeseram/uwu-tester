"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface SystemInfo {
  publicIp: string;
  hostname: string;
  uptime: string;
  loadAvg: string;
}

export default function Navbar() {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [currentTime, setCurrentTime] = useState("");

  useEffect(() => {
    const fetchSystem = async () => {
      try {
        const res = await fetch("/api/system");
        if (res.ok) {
          const data = await res.json();
          setSystemInfo(data);
        }
      } catch (err) {
        console.error("Failed to fetch system info:", err);
      }
    };

    fetchSystem();
    // Refresh system info every 30 seconds
    const interval = setInterval(fetchSystem, 30000);
    return () => clearInterval(interval);
  }, []);

  // Live clock
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const vpsIp = systemInfo?.publicIp ?? "";

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 border-b"
      style={{
        background: "rgba(10, 14, 26, 0.95)",
        borderColor: "#1e2d4a",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <div className="max-w-screen-2xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* Left: Logo + Nav Links */}
        <div className="flex items-center gap-6">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <div
              className="w-8 h-8 rounded flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, #00ff88 0%, #00d4ff 100%)",
              }}
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#0a0e1a"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
            </div>
            <span
              className="font-bold text-sm tracking-wider"
              style={{ color: "#00ff88" }}
            >
              VPS<span style={{ color: "#00d4ff" }}>DEV</span>
            </span>
          </Link>

          {/* Divider */}
          <div
            className="w-px h-6"
            style={{ background: "#1e2d4a" }}
          />

          {/* Nav links */}
          <div className="flex items-center gap-1">
            <Link
              href="/"
              className="flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-all"
              style={{
                color: "#e2e8f0",
                background: "rgba(0, 212, 255, 0.1)",
                border: "1px solid rgba(0, 212, 255, 0.2)",
              }}
            >
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
              </svg>
              Dashboard
            </Link>

            {vpsIp && (
              <>
                <a
                  href="https://code.vidwadeseram.com/terminal/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-all hover:bg-white/5"
                  style={{ color: "#94a3b8" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.color = "#00ff88")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.color = "#94a3b8")
                  }
                >
                  <svg
                    className="w-3.5 h-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="4 17 10 11 4 5" />
                    <line x1="12" y1="19" x2="20" y2="19" />
                  </svg>
                  Terminal
                  <svg
                    className="w-3 h-3 opacity-50"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>

                <a
                  href="https://code.vidwadeseram.com:8443"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-all hover:bg-white/5"
                  style={{ color: "#94a3b8" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.color = "#00d4ff")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.color = "#94a3b8")
                  }
                >
                  <svg
                    className="w-3.5 h-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 8l4 4-4 4M8 12h8" />
                  </svg>
                  Skyvern
                  <svg
                    className="w-3 h-3 opacity-50"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
              </>
            )}

            {/* Loading state for nav links when IP not yet fetched */}
            {!vpsIp && (
              <span
                className="px-3 py-1.5 text-sm"
                style={{ color: "#4a5568" }}
              >
                Loading...
              </span>
            )}
          </div>
        </div>

        {/* Right: System status */}
        <div className="flex items-center gap-4 text-xs" style={{ color: "#94a3b8" }}>
          {systemInfo && (
            <>
              <div className="hidden md:flex items-center gap-1.5">
                <span
                  className="w-1.5 h-1.5 rounded-full pulse-dot"
                  style={{ background: "#00ff88" }}
                />
                <span style={{ color: "#00ff88" }}>{systemInfo.hostname}</span>
              </div>
              <div
                className="hidden lg:flex items-center gap-1.5 px-2 py-1 rounded"
                style={{ background: "rgba(30, 45, 74, 0.5)" }}
              >
                <span className="opacity-60">IP</span>
                <span style={{ color: "#00d4ff" }}>{systemInfo.publicIp}</span>
              </div>
              <div
                className="hidden lg:flex items-center gap-1.5 px-2 py-1 rounded"
                style={{ background: "rgba(30, 45, 74, 0.5)" }}
              >
                <span className="opacity-60">up</span>
                <span>{systemInfo.uptime}</span>
              </div>
              <div
                className="hidden xl:flex items-center gap-1.5 px-2 py-1 rounded"
                style={{ background: "rgba(30, 45, 74, 0.5)" }}
              >
                <span className="opacity-60">load</span>
                <span>{systemInfo.loadAvg}</span>
              </div>
            </>
          )}
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded font-mono"
            style={{
              background: "rgba(30, 45, 74, 0.5)",
              color: "#ffd700",
              minWidth: "70px",
              justifyContent: "center",
            }}
          >
            {currentTime}
          </div>
        </div>
      </div>
    </nav>
  );
}
