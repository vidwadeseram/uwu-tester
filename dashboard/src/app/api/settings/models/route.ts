export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { checkAuth, readSettings, writeSettings } from "@/app/lib/settings";

const DEFAULT_OPENCLAW_MODEL = "openrouter/free";

export interface ORModel {
  id: string;
  name: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
  free: boolean;
  prompt_price_per_m: number;
}

function prettyName(id: string): string {
  const tail = id.split("/").at(-1) ?? id;
  return tail
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export async function GET(_req: NextRequest) {
  const settings = readSettings();
  return NextResponse.json({
    selected: {
      openclaw: settings.models?.openclaw ?? DEFAULT_OPENCLAW_MODEL,
    },
  });
}

export async function POST(req: NextRequest) {
  if (!(await checkAuth(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { openclaw } = await req.json() as { openclaw?: string };
  const settings = readSettings();
  writeSettings({
    ...settings,
    models: {
      ...settings.models,
      openclaw: openclaw ?? settings.models?.openclaw ?? DEFAULT_OPENCLAW_MODEL,
    },
  });
  return NextResponse.json({ ok: true });
}
