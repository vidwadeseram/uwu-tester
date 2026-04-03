import { DiscovererLog } from "./types";
export function createDiscovererLogger(): { logs: DiscovererLog[]; log: (phase: "init" | "scan" | "fetch" | "generate" | "persist" | "complete", message: string, data?: Record<string, unknown>) => void } {
  const logs: DiscovererLog[] = [];
  function log(phase: "init" | "scan" | "fetch" | "generate" | "persist" | "complete", message: string, data?: Record<string, unknown>) {
    const entry: DiscovererLog = {
      timestamp: new Date().toISOString(),
      phase,
      message,
      data,
    };
    logs.push(entry);
  }
  return { logs, log };
}
