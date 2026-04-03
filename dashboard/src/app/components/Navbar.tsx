"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface SystemInfo {
  publicIp: string;
  hostname: string;
  uptime: string;
  loadAvg: string;
}

const NAV = [
  {
    href: "/",
    label: "Dashboard",
    exact: true,
    color: "#00d4ff",
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    href: "/chat",
    label: "Chat",
    exact: false,
    color: "#00ff88",
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },

  {
    href: "/scheduler",
    label: "Scheduler",
    exact: false,
    color: "#ffd700",
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    href: "/openclaw",
    label: "OpenClaw",
    exact: false,
    color: "#00ff88",
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a10 10 0 1 0 10 10" /><path d="M12 6v6l4 2" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    exact: false,
    color: "#94a3b8",
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
      </svg>
    ),
  },
];

export default function Navbar() {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [currentTime, setCurrentTime] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const fetchSystem = async () => {
      try {
        const res = await fetch("/api/system");
        if (res.ok) setSystemInfo(await res.json());
      } catch {
        setSystemInfo(null);
      }
    };
    fetchSystem();
    const interval = setInterval(fetchSystem, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  // Close mobile menu on route change
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  function isActive(href: string, exact: boolean) {
    return exact ? pathname === href : pathname.startsWith(href);
  }

  return (
    <>
      <nav
        className="fixed top-0 left-0 right-0 z-50 border-b"
        style={{ background: "rgba(10,14,26,0.97)", borderColor: "#1e2d4a", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}
      >
        <div className="max-w-screen-2xl mx-auto px-3 sm:px-4 h-14 flex items-center justify-between gap-2 sm:gap-4">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 flex-shrink-0">
            <div className="w-7 h-7 rounded flex items-center justify-center" style={{ background: "linear-gradient(135deg,#00ff88,#00d4ff)" }}>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="#0a0e1a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
              </svg>
            </div>
            <span className="font-bold text-sm tracking-wider hidden sm:block" style={{ color: "#00ff88" }}>
              UWU<span style={{ color: "#00d4ff" }}>CODE</span>
            </span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-0.5 flex-1 justify-center">
            {NAV.map((link) => {
              const active = isActive(link.href, link.exact);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  title={link.label}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-all"
                  style={{
                    color: active ? link.color : "#4a5568",
                    background: active ? `${link.color}12` : "transparent",
                    borderBottom: active ? `2px solid ${link.color}` : "2px solid transparent",
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = link.color; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = "#4a5568"; }}
                >
                  {link.icon}
                  <span className="hidden lg:inline">{link.label}</span>
                </Link>
              );
            })}

            {/* Terminal — external link */}
            <a
              href="/terminal/"
              title="Terminal"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-all"
              style={{ color: "#4a5568", borderBottom: "2px solid transparent" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#00ff88")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#4a5568")}
            >
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
              </svg>
              <span className="hidden lg:inline">Terminal</span>
              <svg className="w-2.5 h-2.5 opacity-40 hidden lg:block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          </div>

          {/* Right: system info + clock */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 min-w-0">
            {systemInfo && (
              <div className="hidden lg:flex items-center gap-2 text-xs" style={{ color: "#4a5568" }}>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: "#00ff88" }} />
                  <span style={{ color: "#00ff88" }}>{systemInfo.hostname}</span>
                </div>
                <div className="px-2 py-0.5 rounded font-mono" style={{ background: "rgba(30,45,74,0.5)", color: "#00d4ff" }}>
                  {systemInfo.publicIp}
                </div>
                <div className="hidden xl:block px-2 py-0.5 rounded" style={{ background: "rgba(30,45,74,0.5)" }}>
                  ↑ {systemInfo.uptime}
                </div>
              </div>
            )}
            <div className="px-1.5 sm:px-2 py-0.5 rounded font-mono text-xs" style={{ background: "rgba(30,45,74,0.5)", color: "#ffd700", minWidth: "54px", textAlign: "center" }}>
              {currentTime}
            </div>

            {/* Mobile menu button */}
            <button
              type="button"
              className="md:hidden flex items-center justify-center w-8 h-8 rounded"
              style={{ background: "rgba(30,45,74,0.5)", color: "#94a3b8" }}
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div
          className="fixed top-14 left-0 right-0 z-40 border-b py-2 max-h-[calc(100vh-3.5rem)] overflow-y-auto"
          style={{ background: "rgba(10,14,26,0.98)", borderColor: "#1e2d4a", backdropFilter: "blur(16px)" }}
        >
          {NAV.map((link) => {
            const active = isActive(link.href, link.exact);
            return (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center gap-3 px-5 py-3 text-sm font-medium transition-colors"
                style={{ color: active ? link.color : "#94a3b8", background: active ? `${link.color}0a` : "transparent" }}
              >
                {link.icon}
                {link.label}
              </Link>
            );
          })}
          <a
            href="/terminal/"
            className="flex items-center gap-3 px-5 py-3 text-sm font-medium"
            style={{ color: "#94a3b8" }}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
            </svg>
            Terminal ↗
          </a>
        </div>
      )}
    </>
  );
}
