"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SystemHeader from "./components/SystemHeader";
import SessionsPanel from "./components/SessionsPanel";
import CorePanel from "./components/CorePanel";
import CoreToolsPanel from "./components/CoreToolsPanel";
import ExposedPortsPanel from "./components/ExposedPortsPanel";
import ProjectsPanel from "./components/ProjectsPanel";
import ExposeModal from "./components/ExposeModal";

export interface SystemData {
  publicIp: string;
  hostname: string;
  uptime: string;
  loadAvg: string;
  memory: { total: number; used: number; free: number; percent: number };
  cpu: { model: string; count: number };
  disk: string;
  platform: string;
}

export interface TmuxWindow {
  windowIndex: number;
  windowName: string;
  active: boolean;
  cwd: string;
  panePid: number | null;
}

export interface TmuxSession {
  name: string;
  windowCount: number;
  created: number;
  windows: TmuxWindow[];
}

export interface PortInfo {
  port: number;
  address: string;
  pid: number | null;
  processName: string;
  protocol: string;
  cwd: string;
  ancestorPids: number[];
  // Matched session info (set client-side)
  matchedSession?: string;
  matchedWindow?: string;
}

export interface ExposeResult {
  success: boolean;
  url: string;
  message: string;
  ufwOutput?: string;
}

export interface CoreService {
  name: string;
  status: string;
  active: boolean;
}

export interface CoreContainer {
  name: string;
  status: string;
  ports: string;
}

export interface CoreData {
  services: CoreService[];
  containers: CoreContainer[];
  uptime: string;
}

export interface ProjectInfo {
  name: string;
  path: string;
  lastModified: string;
  branch: string;
  remoteUrl: string;
}

export interface ProjectGroup {
  name: string;
  path: string;
  projects: ProjectInfo[];
}

export interface ProjectsData {
  groups: ProjectGroup[];
  projects: ProjectInfo[];
}

/**
 * Try to correlate ports with tmux sessions.
 * Strategy 1: CWD match — port process CWD starts with or equals a tmux window CWD.
 * Strategy 2: Ancestor walk — check if any ancestor PID of the port process matches a pane PID.
 */
function correlatePorts(
  ports: PortInfo[],
  sessions: TmuxSession[]
): PortInfo[] {
  // Build a map: panePid -> { sessionName, windowName }
  const paneMap = new Map<
    number,
    { sessionName: string; windowName: string }
  >();
  // Build an array of { cwd, sessionName, windowName } for CWD matching
  const cwdEntries: { cwd: string; sessionName: string; windowName: string }[] =
    [];

  for (const session of sessions) {
    for (const window of session.windows) {
      if (window.panePid) {
        paneMap.set(window.panePid, {
          sessionName: session.name,
          windowName: window.windowName,
        });
      }
      if (window.cwd) {
        cwdEntries.push({
          cwd: window.cwd,
          sessionName: session.name,
          windowName: window.windowName,
        });
      }
    }
  }

  return ports.map((port) => {
    // Strategy 1: CWD match
    if (port.cwd) {
      const match = cwdEntries.find(
        (e) =>
          e.cwd &&
          (port.cwd === e.cwd ||
            port.cwd.startsWith(e.cwd + "/") ||
            e.cwd.startsWith(port.cwd + "/"))
      );
      if (match) {
        return {
          ...port,
          matchedSession: match.sessionName,
          matchedWindow: match.windowName,
        };
      }
    }

    // Strategy 2: Ancestor PID match
    if (port.ancestorPids && port.ancestorPids.length > 0) {
      for (const ancestorPid of port.ancestorPids) {
        const match = paneMap.get(ancestorPid);
        if (match) {
          return {
            ...port,
            matchedSession: match.sessionName,
            matchedWindow: match.windowName,
          };
        }
      }
    }

    return port;
  });
}

export default function DashboardPage() {
  const [systemData, setSystemData] = useState<SystemData | null>(null);
  const [sessions, setSessions] = useState<TmuxSession[]>([]);
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [coreData, setCoreData] = useState<CoreData | null>(null);
  const [projectsData, setProjectsData] = useState<ProjectsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Expose modal state
  const [exposePort, setExposePort] = useState<PortInfo | null>(null);
  const [exposeResult, setExposeResult] = useState<ExposeResult | null>(null);
  const [exposeLoading, setExposeLoading] = useState(false);
  const [exposedRefreshToken, setExposedRefreshToken] = useState(0);

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const fetchAll = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);

    try {
      const [sysRes, sessRes, portsRes, coreRes, projectsRes] =
        await Promise.allSettled([
          fetch("/api/system"),
          fetch("/api/sessions"),
          fetch("/api/ports"),
          fetch("/api/core"),
          fetch("/api/projects"),
        ]);

      if (!isMounted.current) return;

      if (sysRes.status === "fulfilled" && sysRes.value.ok) {
        const data = await sysRes.value.json();
        setSystemData(data);
      }

      let fetchedSessions: TmuxSession[] = [];
      if (sessRes.status === "fulfilled" && sessRes.value.ok) {
        const data = await sessRes.value.json();
        fetchedSessions = data.sessions ?? [];
        setSessions(fetchedSessions);
      }

      if (portsRes.status === "fulfilled" && portsRes.value.ok) {
        const data = await portsRes.value.json();
        const rawPorts: PortInfo[] = data.ports ?? [];
        const correlated = correlatePorts(rawPorts, fetchedSessions);
        setPorts(correlated);
      }

      if (coreRes.status === "fulfilled" && coreRes.value.ok) {
        const data = await coreRes.value.json();
        setCoreData(data);
      }

      if (projectsRes.status === "fulfilled" && projectsRes.value.ok) {
        const data = await projectsRes.value.json();
        setProjectsData(data);
      }

      setLastRefresh(new Date());
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      if (isMounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => fetchAll(), 10000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // Handle expose port
  const handleExpose = (port: PortInfo) => {
    setExposePort(port);
    setExposeResult(null);
  };

  const handleExposeSubmit = async (port: PortInfo) => {
    setExposeLoading(true);
    try {
      const res = await fetch("/api/expose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port: port.port }),
      });
      const data: ExposeResult = await res.json();
      setExposeResult(data);

      if (data.success) {
        fetch("/api/ports")
          .then((r) => r.json())
          .then((d) => {
            const rawPorts: PortInfo[] = d.ports ?? [];
            setPorts(correlatePorts(rawPorts, sessions));
          })
          .catch(() => {});
        setExposedRefreshToken((t) => t + 1);
      }
    } catch {
      setExposeResult({
        success: false,
        url: `http://${systemData?.publicIp ?? "YOUR_VPS_IP"}:${port.port}`,
        message: "Failed to contact API",
      });
    } finally {
      setExposeLoading(false);
    }
  };

  const handleExposeClose = () => {
    setExposePort(null);
    setExposeResult(null);
  };

  const handlePortsChanged = useCallback(() => {
    fetch("/api/ports")
      .then((r) => r.json())
      .then((d) => {
        const rawPorts: PortInfo[] = d.ports ?? [];
        setPorts(correlatePorts(rawPorts, sessions));
      })
      .catch(() => {});
    setExposedRefreshToken((t) => t + 1);
  }, [sessions]);

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6">
      {/* Row 1: System Header (full width) */}
      <SystemHeader
        data={systemData}
        loading={loading}
        lastRefresh={lastRefresh}
        refreshing={refreshing}
        onRefresh={() => fetchAll(true)}
      />

      {/* Row 2: Core Panel — System Services + Docker Containers */}
      <CorePanel data={coreData} defaultCollapsed={true} />

      {/* Core Tools — Exposed Ports + Listening Ports */}
      <CoreToolsPanel
        ports={ports}
        loading={loading}
      />

      <ExposedPortsPanel
        ports={ports}
        onPortsChanged={handlePortsChanged}
        refreshToken={exposedRefreshToken}
      />

      <SessionsPanel
        sessions={sessions}
        ports={ports}
        loading={loading}
        onRefresh={() => fetchAll(true)}
        onExpose={handleExpose}
        onPortsChanged={handlePortsChanged}
        refreshToken={exposedRefreshToken}
      />

      {/* Row 4: Projects Panel (full width) */}
      <ProjectsPanel
        data={projectsData}
        onRefresh={() => fetchAll(true)}
      />

      {/* Expose Modal */}
      {exposePort && (
        <ExposeModal
          port={exposePort}
          result={exposeResult}
          loading={exposeLoading}
          publicIp={systemData?.publicIp ?? "YOUR_VPS_IP"}
          onClose={handleExposeClose}
          onExpose={() => handleExposeSubmit(exposePort)}
        />
      )}
    </div>
  );
}
