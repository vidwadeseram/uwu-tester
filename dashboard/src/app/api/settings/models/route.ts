export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { checkAuth, readSettings, writeSettings, readEnvKeys } from "@/app/lib/settings";

const DEFAULT_TESTS_MODEL = "openai/gpt-5.3-codex";
const DEFAULT_TESTS_CLAUDE_MODEL = "sonnet";
const DEFAULT_TESTS_OPENCODE_MODEL = "opencode/qwen3.6-plus-free";
const DEFAULT_DISCOVERER_API_MODEL = "openrouter/free";
const DEFAULT_DISCOVERER_CLAUDE_MODEL = "sonnet";
const DEFAULT_DISCOVERER_OPENCODE_MODEL = "opencode/qwen3.6-plus-free";
const DEFAULT_CLAUDE_MODELS = ["sonnet", "opus", "haiku"];
const DEFAULT_OPENCODE_MODELS = [
  "opencode/qwen3.6-plus-free",
  "opencode/big-pickle",
  "opencode/gpt-5-nano",
];

export interface ORModel {
  id: string;
  name: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
  free: boolean;
  prompt_price_per_m: number; // USD per 1M tokens
  vision: boolean; // accepts image input (required for browser-use)
}

interface AgentModelOption {
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

function toOptions(ids: string[]): AgentModelOption[] {
  const uniq = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  return uniq.map((id) => ({ id, name: prettyName(id) }));
}

function parseModelIds(raw: string): string[] {
  if (!raw.trim()) return [];
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  const ids: string[] = [];
  for (const line of lines) {
    if (line.startsWith("Usage:") || line.startsWith("Options:") || line.startsWith("Commands:")) continue;
    const token = line.split(/\s+/)[0]?.trim() ?? "";
    if (!token) continue;
    if (/^[a-z0-9][a-z0-9._/-]*$/i.test(token)) {
      ids.push(token);
    }
  }
  return ids;
}

function runCommand(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        timeout: 8000,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          PATH: `${process.env.PATH ?? ""}:/usr/local/bin:/opt/homebrew/bin:/home/uwu/.local/bin`,
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          const rawCode = (error as NodeJS.ErrnoException).code;
          const code = typeof rawCode === "number" ? rawCode : 1;
          resolve({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
          return;
        }
        resolve({ code: 0, stdout: stdout ?? "", stderr: stderr ?? "" });
      }
    );
  });
}

async function listClaudeModels(): Promise<AgentModelOption[]> {
  const attempts: string[][] = [
    ["models", "--json"],
    ["models"],
  ];

  for (const args of attempts) {
    const out = await runCommand("claude", args);
    const combined = `${out.stdout}\n${out.stderr}`.trim();
    if (!combined) continue;

    if (args.includes("--json")) {
      try {
        const parsed = JSON.parse(combined) as Array<{ id?: string; name?: string }>;
        if (Array.isArray(parsed)) {
          const ids = parsed.map((item) => item.id ?? "").filter(Boolean);
          if (ids.length > 0) {
            return toOptions(ids);
          }
        }
      } catch {
      }
    }

    const ids = parseModelIds(combined).filter((id) => !id.includes("/"));
    if (ids.length > 0) {
      return toOptions(ids);
    }
  }

  return toOptions(DEFAULT_CLAUDE_MODELS);
}

async function listOpencodeModels(): Promise<AgentModelOption[]> {
  const out = await runCommand("opencode", ["models"]);
  const combined = `${out.stdout}\n${out.stderr}`.trim();
  const ids = parseModelIds(combined).filter((id) => id.includes("/"));
  if (ids.length > 0) {
    return toOptions(ids);
  }
  return toOptions(DEFAULT_OPENCODE_MODELS);
}

export async function GET(_req: NextRequest) {
  const keys = readEnvKeys();
  const openrouterKey = keys.OPENROUTER_API_KEY;

  let models: ORModel[] = [];
  let error = "";

  if (openrouterKey) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: {
          Authorization: `Bearer ${openrouterKey}`,
          "HTTP-Referer": "https://uwu-code.local",
          "X-Title": "uwu-code",
        },
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        // Exclude non-chat models (media/audio/image generation)
        const NON_CHAT = /lyria|imagen|dall-e|stable-?diffusion|midjourney|flux|sora|whisper|tts|embedding|rerank/i;

        models = (data.data ?? [])
          .filter((m: { id: string; modality?: string; architecture?: { modality?: string } }) => {
            if (NON_CHAT.test(m.id)) return false;
            const modality = m.modality ?? m.architecture?.modality ?? "";
            if (modality && !modality.includes("text")) return false;
            return true;
          })
          .map((m: { id: string; name: string; context_length?: number; pricing?: { prompt?: string; completion?: string }; modality?: string; architecture?: { modality?: string } }) => {
          const promptPrice = parseFloat(m.pricing?.prompt ?? "0");
          const completionPrice = parseFloat(m.pricing?.completion ?? "0");
          const free = promptPrice === 0 && completionPrice === 0;
          const modality = m.modality ?? m.architecture?.modality ?? "";
          const vision = modality.includes("image") || modality.includes("vision");
          return {
            id: m.id,
            name: m.name ?? m.id,
            context_length: m.context_length ?? 0,
            pricing: { prompt: m.pricing?.prompt ?? "0", completion: m.pricing?.completion ?? "0" },
            free,
            prompt_price_per_m: Math.round(promptPrice * 1_000_000 * 100) / 100,
            vision,
          };
        }).sort((a: ORModel, b: ORModel) => {
          // Free first, then by name
          if (a.free && !b.free) return -1;
          if (!a.free && b.free) return 1;
          return a.name.localeCompare(b.name);
        });
      } else {
        error = `OpenRouter API error: ${res.status}`;
      }
    } catch (e) {
      error = `Failed to fetch models: ${e instanceof Error ? e.message : String(e)}`;
    }
  } else {
    error = "No OpenRouter API key configured";
  }

  const settings = readSettings();
  const [claudeModels, opencodeModels] = await Promise.all([
    listClaudeModels(),
    listOpencodeModels(),
  ]);

  return NextResponse.json({
    models,
    claude_models: claudeModels,
    opencode_models: opencodeModels,
    selected: {
      tests: settings.models?.tests ?? DEFAULT_TESTS_MODEL,
      tests_claude: settings.models?.tests_claude ?? DEFAULT_TESTS_CLAUDE_MODEL,
      tests_opencode: settings.models?.tests_opencode ?? settings.models?.tests ?? DEFAULT_TESTS_OPENCODE_MODEL,
      openclaw: settings.models?.openclaw ?? "openrouter/free",
      discoverer: settings.models?.discoverer ?? DEFAULT_DISCOVERER_API_MODEL,
      discoverer_api: settings.models?.discoverer_api ?? settings.models?.discoverer ?? DEFAULT_DISCOVERER_API_MODEL,
      discoverer_claude: settings.models?.discoverer_claude ?? DEFAULT_DISCOVERER_CLAUDE_MODEL,
      discoverer_opencode: settings.models?.discoverer_opencode ?? DEFAULT_DISCOVERER_OPENCODE_MODEL,
    },
    error: error || undefined,
  });
}

export async function POST(req: NextRequest) {
  if (!(await checkAuth(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const {
    tests,
    tests_claude,
    tests_opencode,
    openclaw,
    discoverer,
    discoverer_api,
    discoverer_claude,
    discoverer_opencode,
  } = await req.json() as {
    tests?: string;
    tests_claude?: string;
    tests_opencode?: string;
    openclaw?: string;
    discoverer?: string;
    discoverer_api?: string;
    discoverer_claude?: string;
    discoverer_opencode?: string;
  };
  const settings = readSettings();
  const nextDiscovererApi = discoverer_api ?? discoverer ?? settings.models?.discoverer_api ?? settings.models?.discoverer ?? DEFAULT_DISCOVERER_API_MODEL;
  writeSettings({
    ...settings,
    models: {
      tests: tests ?? settings.models?.tests ?? DEFAULT_TESTS_MODEL,
      tests_claude: tests_claude ?? settings.models?.tests_claude ?? DEFAULT_TESTS_CLAUDE_MODEL,
      tests_opencode: tests_opencode ?? settings.models?.tests_opencode ?? settings.models?.tests ?? DEFAULT_TESTS_OPENCODE_MODEL,
      openclaw: openclaw ?? settings.models?.openclaw ?? "openrouter/free",
      discoverer: nextDiscovererApi,
      discoverer_api: nextDiscovererApi,
      discoverer_claude: discoverer_claude ?? settings.models?.discoverer_claude ?? DEFAULT_DISCOVERER_CLAUDE_MODEL,
      discoverer_opencode: discoverer_opencode ?? settings.models?.discoverer_opencode ?? DEFAULT_DISCOVERER_OPENCODE_MODEL,
    },
  });
  return NextResponse.json({ ok: true });
}
