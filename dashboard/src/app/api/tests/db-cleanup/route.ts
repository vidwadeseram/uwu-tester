import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";

type SupportedDbType = "postgres";

interface DbConnectionInput {
  dbType: SupportedDbType;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

function normalizeIdentifier(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(trimmed)) return null;
  return trimmed;
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function parseTableRef(rawTable: string): { schema: string; table: string } | null {
  const trimmed = rawTable.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(".").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 1) {
    const table = normalizeIdentifier(parts[0]);
    if (!table) return null;
    return { schema: "public", table };
  }
  if (parts.length === 2) {
    const schema = normalizeIdentifier(parts[0]);
    const table = normalizeIdentifier(parts[1]);
    if (!schema || !table) return null;
    return { schema, table };
  }
  return null;
}

function parseConnection(raw: unknown): DbConnectionInput | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const dbType = String(input.dbType ?? "").trim();
  const host = String(input.host ?? "").trim();
  const database = String(input.database ?? "").trim();
  const username = String(input.username ?? "").trim();
  const password = String(input.password ?? "");
  const portRaw = Number(input.port ?? 5432);
  const port = Number.isFinite(portRaw) ? Math.floor(portRaw) : NaN;

  if (dbType !== "postgres") return null;
  if (!host || !database || !username || !password) return null;
  if (!Number.isFinite(port) || port < 1 || port > 65535) return null;

  return {
    dbType: "postgres",
    host,
    port,
    database,
    username,
    password,
  };
}

async function withPgClient<T>(connection: DbConnectionInput, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.username,
    password: connection.password,
    ssl: false,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function loadTables(connection: DbConnectionInput): Promise<string[]> {
  return withPgClient(connection, async (client) => {
    const result = await client.query<{ table_schema: string; table_name: string }>(
      `
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name
      `
    );
    return result.rows.map((row) => `${row.table_schema}.${row.table_name}`);
  });
}

async function loadRows(
  connection: DbConnectionInput,
  tableRef: { schema: string; table: string },
  options: { search: string; offset: number; limit: number }
): Promise<{ rows: Array<Record<string, unknown>>; total: number; nextOffset: number | null }> {
  return withPgClient(connection, async (client) => {
    const columnsResult = await client.query<{ column_name: string }>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
      `,
      [tableRef.schema, tableRef.table]
    );
    const columns = columnsResult.rows.map((row) => row.column_name).filter(Boolean);
    const fromClause = `${quoteIdent(tableRef.schema)}.${quoteIdent(tableRef.table)}`;

    const whereClauses: string[] = [];
    const searchValue = options.search.trim();
    if (searchValue && columns.length > 0) {
      const orClauses = columns.map((column) => `CAST(${quoteIdent(column)} AS TEXT) ILIKE $1`);
      whereClauses.push(`(${orClauses.join(" OR ")})`);
    }
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const searchParams = searchValue ? [`%${searchValue}%`] : [];

    const countResult = await client.query<{ total: string }>(
      `SELECT COUNT(*)::bigint AS total FROM ${fromClause} ${whereSql}`,
      searchParams
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    const paginationBase = searchParams.length;
    const rowsResult = await client.query<Record<string, unknown>>(
      `
        SELECT ctid::text AS "__rowid__", *
        FROM ${fromClause}
        ${whereSql}
        ORDER BY ctid
        LIMIT $${paginationBase + 1}
        OFFSET $${paginationBase + 2}
      `,
      [...searchParams, options.limit, options.offset]
    );

    const nextOffset = options.offset + rowsResult.rows.length < total ? options.offset + rowsResult.rows.length : null;
    return {
      rows: rowsResult.rows,
      total,
      nextOffset,
    };
  });
}

async function deleteRows(
  connection: DbConnectionInput,
  tableRef: { schema: string; table: string },
  rowids: string[]
): Promise<number> {
  return withPgClient(connection, async (client) => {
    const unique = Array.from(new Set(rowids.map((id) => String(id).trim()).filter(Boolean)));
    if (unique.length === 0) return 0;

    const fromClause = `${quoteIdent(tableRef.schema)}.${quoteIdent(tableRef.table)}`;
    const result = await client.query(
      `DELETE FROM ${fromClause} WHERE ctid::text = ANY($1::text[])`,
      [unique]
    );
    return result.rowCount ?? 0;
  });
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

  const input = body as Record<string, unknown>;
  const action = String(input.action ?? "").trim();
  const connection = parseConnection(input.connection);
  if (!connection) {
    return NextResponse.json({ error: "Valid postgres connection credentials are required" }, { status: 400 });
  }

  try {
    if (action === "tables") {
      const tables = await loadTables(connection);
      return NextResponse.json({ tables });
    }

    if (action === "rows") {
      const tableRef = parseTableRef(String(input.table ?? ""));
      if (!tableRef) {
        return NextResponse.json({ error: "table must be schema.table or table" }, { status: 400 });
      }
      const search = String(input.search ?? "");
      const offsetRaw = Number(input.offset ?? 0);
      const limitRaw = Number(input.limit ?? 50);
      const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;
      const data = await loadRows(connection, tableRef, { search, offset, limit });
      return NextResponse.json(data);
    }

    if (action === "delete") {
      const tableRef = parseTableRef(String(input.table ?? ""));
      if (!tableRef) {
        return NextResponse.json({ error: "table must be schema.table or table" }, { status: 400 });
      }
      const rowids = Array.isArray(input.rowids) ? input.rowids.map((value) => String(value)) : [];
      const deleted = await deleteRows(connection, tableRef, rowids);
      return NextResponse.json({ success: true, deleted });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Database operation failed" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    supported: ["postgres"],
    actions: ["tables", "rows", "delete"],
  });
}
