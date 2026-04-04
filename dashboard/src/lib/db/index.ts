import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { existsSync, mkdirSync } from "fs";

const DB_DIR = process.env.DB_DIR || "/opt/uwu-code/data";
const DB_PATH = `${DB_DIR}/uwu-code.db`;

let db: ReturnType<typeof drizzle> | null = null;
let sqlite: Database.Database | null = null;

function ensureTables(sqliteDb: Database.Database) {
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      git_url TEXT,
      default_branch TEXT DEFAULT 'main',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS worktrees (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      branch TEXT NOT NULL,
      port INTEGER,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS coding_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      worktree_id TEXT REFERENCES worktrees(id) ON DELETE SET NULL,
      tool TEXT NOT NULL,
      status TEXT NOT NULL,
      task TEXT NOT NULL,
      result TEXT,
      duration_seconds INTEGER,
      started_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS kanban_tickets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      "column" TEXT NOT NULL,
      position REAL NOT NULL,
      priority TEXT DEFAULT 'medium',
      assignee TEXT,
      labels TEXT,
      due_date INTEGER,
      source_id TEXT,
      source_provider TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      source_worktree_id TEXT NOT NULL REFERENCES worktrees(id) ON DELETE CASCADE,
      target_worktree_id TEXT NOT NULL REFERENCES worktrees(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      notes TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT DEFAULT '#6366f1',
      position REAL NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS space_projects (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      position REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ticket_provider_configs (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      config TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scripts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      content TEXT NOT NULL,
      is_favorite INTEGER DEFAULT 0,
      last_run_at INTEGER,
      run_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS port_registry (
      id TEXT PRIMARY KEY,
      worktree_id TEXT NOT NULL REFERENCES worktrees(id) ON DELETE CASCADE,
      port INTEGER NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lsp_servers (
      id TEXT PRIMARY KEY,
      worktree_id TEXT NOT NULL REFERENCES worktrees(id) ON DELETE CASCADE,
      language TEXT NOT NULL,
      command TEXT NOT NULL,
      args TEXT,
      port INTEGER,
      status TEXT DEFAULT 'stopped',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

export function getDb() {
  if (db) return db;

  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }

  try {
    sqlite = new Database(DB_PATH);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    ensureTables(sqlite);

    db = drizzle(sqlite, { schema });
  } catch (error) {
    console.error("Failed to initialize database:", error);
    throw new Error(`Database initialization failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return db;
}

export function closeDb() {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
    db = null;
  }
}

export { schema };
