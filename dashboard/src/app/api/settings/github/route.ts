export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { checkAuth, readSettings, writeSettings } from "@/app/lib/settings";

export async function GET(req: NextRequest) {
  if (!(await checkAuth(req)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = readSettings();
  const token = settings.github_token || "";
  const masked = token
    ? token.slice(0, 8) + "••••••••" + token.slice(-4)
    : "";

  return NextResponse.json({ token: masked, connected: !!token });
}

export async function POST(req: NextRequest) {
  if (!(await checkAuth(req)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { token } = (await req.json()) as { token: string };

  if (!token?.trim()) {
    return NextResponse.json({ error: "Token is required" }, { status: 400 });
  }

  const trimmed = token.trim();

  if (
    !trimmed.startsWith("ghp_") &&
    !trimmed.startsWith("github_pat_") &&
    !trimmed.startsWith("gho_") &&
    !trimmed.startsWith("ghs_") &&
    !trimmed.startsWith("ghr_")
  ) {
    return NextResponse.json(
      { error: "Invalid token format. GitHub tokens start with ghp_, github_pat_, gho_, ghs_, or ghr_" },
      { status: 400 },
    );
  }

  const settings = readSettings();
  settings.github_token = trimmed;
  writeSettings(settings);

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!(await checkAuth(req)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = readSettings();
  delete settings.github_token;
  writeSettings(settings);

  return NextResponse.json({ ok: true });
}
