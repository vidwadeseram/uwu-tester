import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { resolveWorkspacePath } from "@/app/lib/discoverer";

const IGNORE_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".venv", "venv", "__pycache__"]);
const DB_EXTENSIONS = new Set([".db", ".sqlite", ".sqlite3"]);

interface DbFileEntry {
  path: string;
  name: string;
  bytes: number;
  updatedAt: string;
}

function isInside(root: string, candidate: string): boolean {
  const rootResolved = path.resolve(root);
  const candidateResolved = path.resolve(candidate);
  return candidateResolved === rootResolved || candidateResolved.startsWith(`${rootResolved}${path.sep}`);
}

function listDatabases(workspacePath: string): DbFileEntry[] {
  const results: DbFileEntry[] = [];
  const stack = [workspacePath];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!DB_EXTENSIONS.has(ext)) continue;
      try {
        const stat = fs.statSync(abs);
        results.push({
          path: abs,
          name: path.basename(abs),
          bytes: stat.size,
          updatedAt: stat.mtime.toISOString(),
        });
      } catch {
        continue;
      }
    }
  }
  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

function runPythonJson<T>(mode: string, payload: Record<string, unknown>): Promise<T> {
  const script = [
    "import json, sqlite3, sys",
    "mode = sys.argv[1]",
    "payload = json.loads(sys.argv[2])",
    "def q(name):",
    "    return '\"' + str(name).replace('\"', '\"\"') + '\"'",
    "if mode == 'tables':",
    "    db_path = payload['dbPath']",
    "    conn = sqlite3.connect(db_path)",
    "    cur = conn.cursor()",
    "    cur.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name\")",
    "    names = [r[0] for r in cur.fetchall()]",
    "    conn.close()",
    "    print(json.dumps({'tables': names}))",
    "elif mode == 'rows':",
    "    db_path = payload['dbPath']",
    "    table = payload['table']",
    "    search = str(payload.get('search') or '').strip()",
    "    offset = int(payload.get('offset') or 0)",
    "    limit = max(1, min(int(payload.get('limit') or 50), 200))",
    "    conn = sqlite3.connect(db_path)",
    "    conn.row_factory = sqlite3.Row",
    "    cur = conn.cursor()",
    "    table_q = q(table)",
    "    cur.execute(f'PRAGMA table_info({table_q})')",
    "    columns = [r[1] for r in cur.fetchall()]",
    "    where = ''",
    "    params = []",
    "    if search and columns:",
    "        clauses = [f'CAST({q(c)} AS TEXT) LIKE ?' for c in columns]",
    "        where = ' WHERE ' + ' OR '.join(clauses)",
    "        params = ['%' + search + '%'] * len(columns)",
    "    cur.execute(f'SELECT COUNT(*) FROM {table_q}' + where, params)",
    "    total = int(cur.fetchone()[0])",
    "    cur.execute(f'SELECT rowid as __rowid__, * FROM {table_q}' + where + ' ORDER BY rowid LIMIT ? OFFSET ?', params + [limit, offset])",
    "    rows = []",
    "    for item in cur.fetchall():",
    "        row = {}",
    "        for key in item.keys():",
    "            value = item[key]",
    "            if isinstance(value, bytes):",
    "                row[key] = f'<bytes:{len(value)}>'",
    "            else:",
    "                row[key] = value",
    "        rows.append(row)",
    "    conn.close()",
    "    print(json.dumps({'rows': rows, 'total': total, 'nextOffset': (offset + len(rows)) if (offset + len(rows)) < total else None}))",
    "elif mode == 'delete':",
    "    db_path = payload['dbPath']",
    "    table = payload['table']",
    "    rowids = payload.get('rowids') or []",
    "    clean = []",
    "    for value in rowids:",
    "        try:",
    "            clean.append(int(value))",
    "        except Exception:",
    "            pass",
    "    if not clean:",
    "        print(json.dumps({'deleted': 0}))",
    "        sys.exit(0)",
    "    conn = sqlite3.connect(db_path)",
    "    cur = conn.cursor()",
    "    table_q = q(table)",
    "    marks = ','.join(['?'] * len(clean))",
    "    cur.execute(f'DELETE FROM {table_q} WHERE rowid IN ({marks})', clean)",
    "    deleted = cur.rowcount if cur.rowcount is not None else 0",
    "    conn.commit()",
    "    conn.close()",
    "    print(json.dumps({'deleted': int(deleted)}))",
    "else:",
    "    raise SystemExit('unsupported mode')",
  ].join("\n");

  return new Promise((resolve, reject) => {
    execFile("python3", ["-c", script, mode, JSON.stringify(payload)], { timeout: 30_000, maxBuffer: 12 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error((stderr || String(err)).trim() || "python sqlite helper failed"));
        return;
      }
      try {
        resolve(JSON.parse((stdout || "").trim() || "{}") as T);
      } catch {
        reject(new Error(`Invalid sqlite helper output: ${stdout || stderr}`));
      }
    });
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const workspaceRaw = (searchParams.get("workspacePath") ?? "").trim();
  const workspacePath = resolveWorkspacePath(workspaceRaw);
  if (!workspacePath) {
    return NextResponse.json({ error: "workspacePath must be under allowed roots" }, { status: 400 });
  }

  const action = (searchParams.get("action") ?? "databases").trim();
  const search = (searchParams.get("search") ?? "").trim().toLowerCase();
  const offset = Math.max(0, Number(searchParams.get("offset") ?? "0") || 0);
  const limit = Math.max(1, Math.min(200, Number(searchParams.get("limit") ?? "50") || 50));

  if (action === "databases") {
    const all = listDatabases(workspacePath);
    const filtered = search
      ? all.filter((entry) => entry.name.toLowerCase().includes(search) || entry.path.toLowerCase().includes(search))
      : all;
    const items = filtered.slice(offset, offset + limit);
    const nextOffset = offset + items.length < filtered.length ? offset + items.length : null;
    return NextResponse.json({ items, total: filtered.length, nextOffset });
  }

  const dbPathRaw = (searchParams.get("dbPath") ?? "").trim();
  const dbPath = path.resolve(dbPathRaw);
  if (!dbPathRaw || !isInside(workspacePath, dbPath) || !fs.existsSync(dbPath)) {
    return NextResponse.json({ error: "dbPath must exist under workspacePath" }, { status: 400 });
  }

  if (action === "tables") {
    try {
      const data = await runPythonJson<{ tables: string[] }>("tables", { dbPath });
      return NextResponse.json({ tables: data.tables ?? [] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (action === "rows") {
    const table = (searchParams.get("table") ?? "").trim();
    if (!table) return NextResponse.json({ error: "table is required" }, { status: 400 });
    try {
      const data = await runPythonJson<{ rows: Array<Record<string, unknown>>; total: number; nextOffset?: number | null }>("rows", {
        dbPath,
        table,
        search: searchParams.get("search") ?? "",
        offset,
        limit,
      });
      return NextResponse.json(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }

  const parsed = body as Record<string, unknown>;
  const action = String(parsed.action ?? "").trim();
  if (action !== "delete") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  const workspaceRaw = typeof parsed.workspacePath === "string" ? parsed.workspacePath.trim() : "";
  const workspacePath = resolveWorkspacePath(workspaceRaw);
  if (!workspacePath) {
    return NextResponse.json({ error: "workspacePath must be under allowed roots" }, { status: 400 });
  }

  const dbPathRaw = typeof parsed.dbPath === "string" ? parsed.dbPath.trim() : "";
  const table = typeof parsed.table === "string" ? parsed.table.trim() : "";
  const rowids = Array.isArray(parsed.rowids) ? parsed.rowids : [];
  const dbPath = path.resolve(dbPathRaw);

  if (!dbPathRaw || !table || !isInside(workspacePath, dbPath) || !fs.existsSync(dbPath)) {
    return NextResponse.json({ error: "Invalid dbPath/table" }, { status: 400 });
  }

  try {
    const data = await runPythonJson<{ deleted: number }>("delete", { dbPath, table, rowids });
    return NextResponse.json({ success: true, deleted: data.deleted ?? 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
