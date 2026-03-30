import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const TEST_CASES_DIR = path.join(process.cwd(), "..", "regression_tests", "test_cases");

function envFile(project: string) {
  return path.join(TEST_CASES_DIR, `${project}.env.json`);
}

/** GET /api/tests/env?project=slug — return stored env vars */
export async function GET(req: NextRequest) {
  const project = new URL(req.url).searchParams.get("project");
  if (!project || !/^[a-zA-Z0-9_-]+$/.test(project))
    return NextResponse.json({ error: "Invalid project" }, { status: 400 });

  try {
    const data = fs.existsSync(envFile(project))
      ? JSON.parse(fs.readFileSync(envFile(project), "utf-8"))
      : {};
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({});
  }
}

/** PUT /api/tests/env?project=slug — save env vars (body: { KEY: "value", ... }) */
export async function PUT(req: NextRequest) {
  const project = new URL(req.url).searchParams.get("project");
  if (!project || !/^[a-zA-Z0-9_-]+$/.test(project))
    return NextResponse.json({ error: "Invalid project" }, { status: 400 });

  const body = await req.json();
  if (!fs.existsSync(TEST_CASES_DIR)) fs.mkdirSync(TEST_CASES_DIR, { recursive: true });
  fs.writeFileSync(envFile(project), JSON.stringify(body, null, 2));
  return NextResponse.json({ success: true });
}
