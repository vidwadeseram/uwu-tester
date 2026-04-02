import { NextRequest, NextResponse } from "next/server";
import { listDiscovererHistory } from "@/app/lib/discoverer-history";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const project = (searchParams.get("project") ?? "").trim();
  const limitRaw = Number(searchParams.get("limit") ?? "40");
  const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.floor(limitRaw))) : 40;

  if (project && !/^[a-z0-9_-]+$/i.test(project)) {
    return NextResponse.json({ error: "Invalid project" }, { status: 400 });
  }

  const entries = listDiscovererHistory(project || undefined, limit);
  return NextResponse.json({
    entries,
    total: entries.length,
  });
}
