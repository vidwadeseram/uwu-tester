export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { readEnvKeys, readSettings } from "@/app/lib/settings";

const SYSTEM = `You are openclaw, an AI assistant built into a VPS development dashboard.
You help with coding, debugging, server management, research, and anything the developer needs.
You have access to context about the user's VPS environment.
For longer autonomous tasks, suggest using the Scheduler page (/scheduler).
Be concise, direct, and practical. Use markdown for code blocks.`;

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export async function POST(req: NextRequest) {
  const body = await req.json() as unknown;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = body as { messages?: ChatMessage[] };
  const messages = parsed.messages;

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }

  const keys = readEnvKeys();
  const openrouterKey = keys.OPENROUTER_API_KEY;
  const anthropicKey  = keys.ANTHROPIC_API_KEY;
  const openaiKey     = keys.OPENAI_API_KEY;

  // Read model preference from settings.json
  const settings = readSettings();
  const openrouterModel = settings.models?.openclaw ?? "openrouter/free";

  const full: ChatMessage[] = [{ role: "system", content: SYSTEM }, ...messages];
  let lastError = "";

  // ── 1. OpenRouter ─────────────────────────────────────────────────────────
  if (openrouterKey) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openrouterKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://uwu-code.local",
          "X-Title": "openclaw",
        },
        body: JSON.stringify({ model: openrouterModel, messages: full, max_tokens: 4096 }),
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json({ message: data.choices[0].message.content });
      }
      const errData = await res.json().catch(() => ({}));
      lastError = errData?.error?.message ?? `OpenRouter error ${res.status}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  // ── 2. Anthropic direct ───────────────────────────────────────────────────
  if (anthropicKey) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku-20241022",
          max_tokens: 4096,
          system: SYSTEM,
          messages: messages.filter((m) => m.role !== "system"),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json({ message: data.content[0].text });
      }
      const errData = await res.json().catch(() => ({}));
      lastError = errData?.error?.message ?? `Anthropic error ${res.status}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  // ── 3. OpenAI direct ──────────────────────────────────────────────────────
  if (openaiKey) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: full, max_tokens: 4096 }),
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json({ message: data.choices[0].message.content });
      }
      const errData = await res.json().catch(() => ({}));
      lastError = errData?.error?.message ?? `OpenAI error ${res.status}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  if (!openrouterKey && !anthropicKey && !openaiKey) {
    return NextResponse.json(
      { error: "No API key configured. Add one in Settings (/settings)." },
      { status: 503 }
    );
  }

  return NextResponse.json(
    { error: lastError || "All providers failed. Check your API keys and credits in Settings." },
    { status: 503 }
  );
}
