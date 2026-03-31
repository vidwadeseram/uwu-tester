import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

type AgentTarget = "claude" | "opencode";

const REGRESSION_DIR = path.join(process.cwd(), "..", "regression_tests");

function parseSelection(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => /^[a-zA-Z0-9_-]+$/.test(v));
}

function buildScopeInstruction(workflowIds: string[], caseIds: string[]): string {
  if (workflowIds.length > 0) {
    return `Run only workflows: ${workflowIds.join(", ")}. Also include any required case dependencies.`;
  }
  if (caseIds.length > 0) {
    return `Run only case IDs: ${caseIds.join(", ")}. Also include any required case dependencies.`;
  }
  return "Run all enabled test cases.";
}

function buildPrompt(project: string, workflowIds: string[], caseIds: string[]): string {
  const scope = buildScopeInstruction(workflowIds, caseIds);
  return [
    `Read the test cases for project '${project}' from MCP resource uwu://projects/${project}/cases.`,
    scope,
    "Do NOT run test_runner.py and do NOT call any run_tests tool.",
    "Execute cases yourself as a browser agent using Playwright from /opt/vps-dashboard/regression_tests/.venv/bin/python.",
    "For every case, capture a recording and keep artifacts under results/<project>/recordings/manual/<run_id>/<case_id>/.",
    "After all cases, call save_results tool with full details and include recording path for each case.",
    "Finally return a detailed pass/fail report for each case.",
  ].join(" ");
}

function runCommand(target: AgentTarget, prompt: string): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const args =
      target === "claude"
        ? [
            "-u",
            "uwu",
            "claude",
            "--dangerously-skip-permissions",
            "-p",
            prompt,
          ]
        : ["-u", "uwu", "opencode", "run", "--dir", REGRESSION_DIR, prompt];

    const child = spawn("sudo", args, {
      cwd: target === "claude" ? "/home/uwu" : REGRESSION_DIR,
      env: process.env,
    });

    let output = "";
    const append = (buf: Buffer) => {
      output += buf.toString("utf-8");
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, 20 * 60 * 1000);

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ exitCode: code ?? 1, output });
    });
  });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const project = String(body.project ?? "").trim();
  const target = String(body.target ?? "").trim() as AgentTarget;
  const workflowIds = parseSelection(body.workflow_ids);
  const caseIds = parseSelection(body.case_ids);

  if (!/^[a-zA-Z0-9_-]+$/.test(project)) {
    return NextResponse.json({ error: "Invalid project" }, { status: 400 });
  }
  if (target !== "claude" && target !== "opencode") {
    return NextResponse.json({ error: "Invalid target" }, { status: 400 });
  }

  const prompt = buildPrompt(project, workflowIds, caseIds);
  const { exitCode, output } = await runCommand(target, prompt);

  return NextResponse.json({
    success: exitCode === 0,
    exitCode,
    output,
  });
}
