export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { checkAuth, readSettings, writeSettings, readEnvKeys } from "@/app/lib/settings";

export interface ORModel {
  id: string;
  name: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
  free: boolean;
  prompt_price_per_m: number; // USD per 1M tokens
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
          "HTTP-Referer": "https://vpsdev.local",
          "X-Title": "uwu-tester",
        },
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        models = (data.data ?? []).map((m: { id: string; name: string; context_length?: number; pricing?: { prompt?: string; completion?: string } }) => {
          const promptPrice = parseFloat(m.pricing?.prompt ?? "0");
          const completionPrice = parseFloat(m.pricing?.completion ?? "0");
          const free = promptPrice === 0 && completionPrice === 0;
          return {
            id: m.id,
            name: m.name ?? m.id,
            context_length: m.context_length ?? 0,
            pricing: { prompt: m.pricing?.prompt ?? "0", completion: m.pricing?.completion ?? "0" },
            free,
            prompt_price_per_m: Math.round(promptPrice * 1_000_000 * 100) / 100,
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
  return NextResponse.json({
    models,
    selected: settings.models ?? { tests: "anthropic/claude-3-5-haiku", openclaw: "anthropic/claude-opus-4" },
    error: error || undefined,
  });
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tests, openclaw } = await req.json() as { tests?: string; openclaw?: string };
  const settings = readSettings();
  writeSettings({
    ...settings,
    models: {
      tests: tests ?? settings.models?.tests ?? "anthropic/claude-3-5-haiku",
      openclaw: openclaw ?? settings.models?.openclaw ?? "anthropic/claude-opus-4",
    },
  });
  return NextResponse.json({ ok: true });
}
