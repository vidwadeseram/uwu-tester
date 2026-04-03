export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function runCommand(cmd: string): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, { timeout: 8000 });
    return stdout.trim();
  } catch {
    return "";
  }
}

export async function GET() {
  try {
    // Check systemctl status for each service
    const serviceNames = ["uwu-code", "uwu-code-ttyd", "nginx", "docker"];

    const serviceStatuses = await Promise.all(
      serviceNames.map(async (name) => {
        const output = await runCommand(`systemctl is-active ${name}`);
        const status = output.trim();
        const active = status === "active";
        return { name, status: status || "unknown", active };
      })
    );

    // Get docker containers
    const dockerOutput = await runCommand(
      `docker ps --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"`
    );

    const containers: { name: string; status: string; ports: string }[] = [];
    if (dockerOutput) {
      for (const line of dockerOutput.split("\n")) {
        if (!line.trim()) continue;
        const parts = line.split("\t");
        containers.push({
          name: parts[0]?.trim() ?? "",
          status: parts[1]?.trim() ?? "",
          ports: parts[2]?.trim() ?? "",
        });
      }
    }

    const services = [...serviceStatuses];

    // Uptime
    const uptime = await runCommand("uptime -p");

    return NextResponse.json({
      services,
      containers,
      uptime: uptime || "unknown",
    });
  } catch (error) {
    console.error("[/api/core] Error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve core info" },
      { status: 500 }
    );
  }
}
