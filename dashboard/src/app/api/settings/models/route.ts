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
  vision: boolean; // accepts image input (required for browser-use)
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
  return NextResponse.json({
    models,
    selected: {
      tests: settings.models?.tests ?? "openrouter/free",
      openclaw: settings.models?.openclaw ?? "openrouter/free",
      discoverer: settings.models?.discoverer ?? "openrouter/free",
    },
    error: error || undefined,
  });
}

export async function POST(req: NextRequest) {
  if (!(await checkAuth(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tests, openclaw, discoverer } = await req.json() as { tests?: string; openclaw?: string; discoverer?: string };
  const settings = readSettings();
  writeSettings({
    ...settings,
    models: {
      tests: tests ?? settings.models?.tests ?? "openrouter/free",
      openclaw: openclaw ?? settings.models?.openclaw ?? "openrouter/free",
      discoverer: discoverer ?? settings.models?.discoverer ?? "openrouter/free",
    },
  });
  return NextResponse.json({ ok: true });
}
