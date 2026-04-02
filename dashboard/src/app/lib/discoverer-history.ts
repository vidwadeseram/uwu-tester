import fs from "fs";
import path from "path";
import crypto from "crypto";
import { allowedWorkspaceRoots, upsertKnowledgeIndex } from "@/app/lib/discoverer";

export type DiscoverGenerationTarget = "api" | "claude" | "opencode";

export interface DiscovererHistoryChange {
  kind: "tests" | "docs";
  path: string;
  existedBefore: boolean;
  existsAfter: boolean;
  changed: boolean;
  beforeBytes: number;
  afterBytes: number;
  beforeHash?: string;
  afterHash?: string;
  beforeSnapshot?: string;
  afterSnapshot?: string;
}

export interface DiscovererHistoryEntry {
  id: string;
  project: string;
  workspacePath: string;
  generationTarget: DiscoverGenerationTarget;
  generationModel?: string;
  generationWarning?: string;
  createdAt: string;
  changes: DiscovererHistoryChange[];
}

interface SnapshotInput {
  path: string;
  beforeContent: string | null;
}

interface RecordHistoryInput {
  project: string;
  workspacePath: string;
  generationTarget: DiscoverGenerationTarget;
  generationModel?: string;
  generationWarning?: string;
  tests?: SnapshotInput;
  docs?: SnapshotInput;
}

const DASHBOARD_ROOT = path.join(process.cwd(), "..");
const REGRESSION_DIR = path.join(DASHBOARD_ROOT, "regression_tests");
const HISTORY_ROOT = path.join(REGRESSION_DIR, "results", "discoverer", "history");
const ENTRIES_DIR = path.join(HISTORY_ROOT, "entries");
const SNAPSHOTS_DIR = path.join(HISTORY_ROOT, "snapshots");

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function normalizePath(input: string): string {
  return path.resolve(input).replace(/\\/g, "/").replace(/\/+$/, "");
}

function hashText(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function readTextIfExists(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function writeSnapshot(entryId: string, kind: "tests" | "docs", stage: "before" | "after", content: string): string {
  ensureDir(SNAPSHOTS_DIR);
  const filePath = path.join(SNAPSHOTS_DIR, `${entryId}.${kind}.${stage}.txt`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

function buildChange(entryId: string, kind: "tests" | "docs", targetPath: string, beforeContent: string | null): DiscovererHistoryChange {
  const absPath = normalizePath(targetPath);
  const afterContent = readTextIfExists(absPath);
  const existedBefore = beforeContent !== null;
  const existsAfter = afterContent !== null;
  const changed = beforeContent !== afterContent;

  const beforeHash = beforeContent !== null ? hashText(beforeContent) : undefined;
  const afterHash = afterContent !== null ? hashText(afterContent) : undefined;
  const beforeSnapshot = beforeContent !== null ? writeSnapshot(entryId, kind, "before", beforeContent) : undefined;
  const afterSnapshot = afterContent !== null ? writeSnapshot(entryId, kind, "after", afterContent) : undefined;

  return {
    kind,
    path: absPath,
    existedBefore,
    existsAfter,
    changed,
    beforeBytes: beforeContent !== null ? Buffer.byteLength(beforeContent, "utf-8") : 0,
    afterBytes: afterContent !== null ? Buffer.byteLength(afterContent, "utf-8") : 0,
    beforeHash,
    afterHash,
    beforeSnapshot,
    afterSnapshot,
  };
}

function entryPath(entryId: string): string {
  return path.join(ENTRIES_DIR, `${entryId}.json`);
}

function allowedManagedRoots(): string[] {
  return Array.from(new Set([
    normalizePath(DASHBOARD_ROOT),
    normalizePath(REGRESSION_DIR),
    ...allowedWorkspaceRoots().map((root) => normalizePath(root)),
  ]));
}

function isUnderAllowedRoot(candidate: string): boolean {
  const normalized = normalizePath(candidate);
  return allowedManagedRoots().some((root) => normalized === root || normalized.startsWith(`${root}/`));
}

export function recordDiscovererHistory(input: RecordHistoryInput): DiscovererHistoryEntry | null {
  const hasTests = Boolean(input.tests?.path);
  const hasDocs = Boolean(input.docs?.path);
  if (!hasTests && !hasDocs) return null;

  ensureDir(ENTRIES_DIR);

  const id = `${new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z")}-${Math.random().toString(36).slice(2, 8)}`;
  const changes: DiscovererHistoryChange[] = [];

  if (input.tests?.path) {
    changes.push(buildChange(id, "tests", input.tests.path, input.tests.beforeContent));
  }
  if (input.docs?.path) {
    changes.push(buildChange(id, "docs", input.docs.path, input.docs.beforeContent));
  }

  const changedAny = changes.some((change) => change.changed);
  if (!changedAny) {
    return null;
  }

  const entry: DiscovererHistoryEntry = {
    id,
    project: input.project,
    workspacePath: normalizePath(input.workspacePath),
    generationTarget: input.generationTarget,
    generationModel: input.generationModel,
    generationWarning: input.generationWarning,
    createdAt: new Date().toISOString(),
    changes,
  };

  fs.writeFileSync(entryPath(id), JSON.stringify(entry, null, 2));
  return entry;
}

export function listDiscovererHistory(project?: string, limit = 40): DiscovererHistoryEntry[] {
  ensureDir(ENTRIES_DIR);
  const files = fs.readdirSync(ENTRIES_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .reverse();

  const results: DiscovererHistoryEntry[] = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(ENTRIES_DIR, file), "utf-8")) as DiscovererHistoryEntry;
      if (!parsed?.id || !parsed?.project || !Array.isArray(parsed.changes)) continue;
      if (project && parsed.project !== project) continue;
      results.push(parsed);
      if (results.length >= limit) break;
    } catch {
      continue;
    }
  }
  return results;
}

export function getDiscovererHistoryEntry(id: string): DiscovererHistoryEntry | null {
  if (!id.trim()) return null;
  const file = entryPath(id.trim());
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as DiscovererHistoryEntry;
    if (!parsed?.id || !parsed?.project || !Array.isArray(parsed.changes)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function revertDiscovererHistory(id: string): {
  entry: DiscovererHistoryEntry;
  restored: string[];
  missingSnapshots: string[];
} | null {
  const entry = getDiscovererHistoryEntry(id);
  if (!entry) return null;

  const restored: string[] = [];
  const missingSnapshots: string[] = [];

  for (const change of entry.changes) {
    const targetPath = normalizePath(change.path);
    if (!isUnderAllowedRoot(targetPath)) {
      missingSnapshots.push(change.path);
      continue;
    }

    if (!change.afterSnapshot || !fs.existsSync(change.afterSnapshot)) {
      if (!change.existsAfter) {
        try {
          if (fs.existsSync(targetPath)) {
            fs.unlinkSync(targetPath);
          }
          restored.push(targetPath);
        } catch {
          missingSnapshots.push(change.path);
        }
        continue;
      }
      missingSnapshots.push(change.path);
      continue;
    }

    try {
      const content = fs.readFileSync(change.afterSnapshot, "utf-8");
      ensureDir(path.dirname(targetPath));
      fs.writeFileSync(targetPath, content);
      restored.push(targetPath);
      if (change.kind === "docs") {
        upsertKnowledgeIndex(entry.project, entry.workspacePath, targetPath);
      }
    } catch {
      missingSnapshots.push(change.path);
    }
  }

  return { entry, restored, missingSnapshots };
}
