import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const REGRESSION_DIR = path.join(process.cwd(), "..", "regression_tests");
const TEST_CASES_DIR = path.join(REGRESSION_DIR, "test_cases");

function ensureTestCasesDir() {
  if (!fs.existsSync(TEST_CASES_DIR)) {
    fs.mkdirSync(TEST_CASES_DIR, { recursive: true });
  }
}

/** GET /api/tests/cases                 → list of available project slugs
 *  GET /api/tests/cases?project=slug   → full test config for that project */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const project = searchParams.get("project");

  ensureTestCasesDir();

  if (!project) {
    // Return list of available slugs
    const files = fs.existsSync(TEST_CASES_DIR)
      ? fs.readdirSync(TEST_CASES_DIR).filter((f) => /^[a-zA-Z0-9_-]+\.json$/.test(f))
      : [];
    const slugs = files.map((f) => f.replace(/\.json$/, ""));
    return NextResponse.json({ projects: slugs });
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(project)) {
    return NextResponse.json({ error: "Invalid project name" }, { status: 400 });
  }

  const file = path.join(TEST_CASES_DIR, `${project}.json`);
  if (!fs.existsSync(file)) {
    return NextResponse.json(
      {
        project,
        description: "",
        test_cases: [],
        workflows: [],
      }
    );
  }

  try {
    const content = JSON.parse(fs.readFileSync(file, "utf-8"));
    return NextResponse.json(content);
  } catch {
    return NextResponse.json({ error: "Failed to read test cases" }, { status: 500 });
  }
}

/** PUT /api/tests/cases?project=slug  — save full test config (body = JSON) */
export async function PUT(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const project = searchParams.get("project");

  if (!project || !/^[a-zA-Z0-9_-]+$/.test(project)) {
    return NextResponse.json({ error: "Invalid project name" }, { status: 400 });
  }

  ensureTestCasesDir();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const file = path.join(TEST_CASES_DIR, `${project}.json`);
  fs.writeFileSync(file, JSON.stringify(body, null, 2));

  return NextResponse.json({ success: true });
}
