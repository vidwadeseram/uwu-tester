export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { checkAuth, readSettings, writeSettings } from "@/app/lib/settings";

const DEFAULT_OPENCLAW_MODEL = "openrouter/free";
const DEFAULT_OPENCODE_MODEL = "";

const OPENCODE_CONFIG = path.join(os.homedir(), ".config", "opencode", "opencode.json");

export interface ORModel {
  id: string;
  name: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
  free: boolean;
  prompt_price_per_m: number;
}

export interface SimpleModel {
  id: string;
  name: string;
}

function prettyName(id: string): string {
  const tail = id.split("/").at(-1) ?? id;
  return tail
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function readJsonFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  try { return JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { return {}; }
}

function writeJsonFile(filePath: string, data: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getOpencodeModels(): SimpleModel[] {
  try {
    const output = execSync("opencode models", {
      timeout: 10000,
      env: { ...process.env, HOME: os.homedir() },
      cwd: os.homedir(),
    }).toString().trim();
    return output
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((id) => ({ id, name: prettyName(id) }));
  } catch {
    return [];
  }
}

function getOpencodeSelected(): string {
  const cfg = readJsonFile(OPENCODE_CONFIG);
  return (cfg.model as string) ?? DEFAULT_OPENCODE_MODEL;
}

export async function GET(_req: NextRequest) {
  const settings = readSettings();
  const opencodeModels = getOpencodeModels();

  return NextResponse.json({
    models: [],
    selected: {
      openclaw: settings.models?.openclaw ?? DEFAULT_OPENCLAW_MODEL,
      opencode: getOpencodeSelected(),
    },
    opencodeModels,
  });
}

export async function POST(req: NextRequest) {
  if (!(await checkAuth(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { openclaw?: string; opencode?: string };

  const settings = readSettings();
  writeSettings({
    ...settings,
    models: {
      ...settings.models,
      openclaw: body.openclaw ?? settings.models?.openclaw ?? DEFAULT_OPENCLAW_MODEL,
    },
  });

  if (body.opencode !== undefined) {
    const cfg = readJsonFile(OPENCODE_CONFIG);
    if (body.opencode) {
      cfg.model = body.opencode;
    } else {
      delete cfg.model;
    }
    writeJsonFile(OPENCODE_CONFIG, cfg);
  }

  return NextResponse.json({ ok: true });
}
