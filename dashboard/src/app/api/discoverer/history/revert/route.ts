import { NextRequest, NextResponse } from "next/server";
import { revertDiscovererHistory } from "@/app/lib/discoverer-history";

export const dynamic = "force-dynamic";

interface RevertRequest {
  id?: string;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = (body ?? {}) as RevertRequest;
  const id = (parsed.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const result = revertDiscovererHistory(id);
  if (!result) {
    return NextResponse.json({ error: "History entry not found" }, { status: 404 });
  }

  const reviewTargets = result.entry.changes
    .map((change) => change.path)
    .filter((value, index, arr) => arr.indexOf(value) === index);

  return NextResponse.json({
    ok: true,
    id: result.entry.id,
    restored: result.restored,
    missingSnapshots: result.missingSnapshots,
    reviewTargets,
    entry: result.entry,
  });
}
