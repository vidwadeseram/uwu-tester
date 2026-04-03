import fs from "fs";
import path from "path";
import crypto from "crypto";
import { NextRequest } from "next/server";
import { verifySessionToken } from "@/app/lib/auth-token";

const SETTINGS_FILE = path.join(process.cwd(), "..", "settings.json");
const ENV_FILE = path.join(process.cwd(), "..", ".env");

export interface Settings {
  username: string;
  password_hash: string;
  session_token: string;
  models?: {
    openclaw?: string;
  };
}

export function readSettings(): Settings {
  if (!fs.existsSync(SETTINGS_FILE))
    return { username: "", password_hash: "", session_token: "" };
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
  } catch {
    return { username: "", password_hash: "", session_token: "" };
  }
}

export function writeSettings(s: Settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
}

export function hashPassword(p: string): string {
  return crypto.createHash("sha256").update(p).digest("hex");
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function checkAuth(req: NextRequest): Promise<boolean> {
  const settings = readSettings();
  if (!settings.username) return false;
  const token = req.cookies.get("uwu_session")?.value;
  const payload = await verifySessionToken(token);
  return !!payload && payload.username === settings.username;
}

export function readEnvKeys(): Record<string, string> {
  const keys: Record<string, string> = {
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
    OPENROUTER_API_KEY: "",
  };
  if (!fs.existsSync(ENV_FILE)) return keys;
  for (const line of fs.readFileSync(ENV_FILE, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [k, ...rest] = trimmed.split("=");
    const v = rest.join("=").replace(/^["']|["']$/g, "");
    if (k in keys) keys[k] = v;
  }
  return keys;
}

export function writeEnvKey(key: string, value: string) {
  let content = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf-8") : "";
  const lines = content.split("\n");
  const idx = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
  const newLine = `${key}="${value}"`;
  if (idx >= 0) {
    lines[idx] = newLine;
  } else {
    lines.push(newLine);
  }
  fs.writeFileSync(ENV_FILE, lines.join("\n"));
}
