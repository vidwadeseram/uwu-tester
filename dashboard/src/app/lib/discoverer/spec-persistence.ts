import fs from "fs";
import path from "path";
import {
  allowedWorkspaceRoots,
  mergeDiscovererTestConfig,
  writeKnowledge,
} from "@/app/lib/discoverer";
import type { DiscovererTestConfig, DiscovererMergeReport } from "@/app/lib/discoverer";
import { recordDiscovererHistory } from "@/app/lib/discoverer-history";
import type { DiscoverGenerationTarget } from "@/app/lib/discoverer-history";

function normalizeForCompare(input: string): string {
  return path.resolve(input).replace(/\\+/g, "/").replace(/\/+$/, "");
}

function isWithinAnyAllowedRoot(candidate: string): boolean {
  const normalizedCandidate = normalizeForCompare(candidate);
  return allowedWorkspaceRoots().some((root) => {
    const normalizedRoot = normalizeForCompare(root);
    return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
  });
}

export interface PathResolution {
  resolved: string | null;
  rejected: boolean;
  reason?: string;
}

export function resolvePersistPath(raw: string, workspacePath: string): string | null {
  return resolvePersistPathWithReason(raw, workspacePath).resolved;
}

export function resolvePersistPathWithReason(raw: string, workspacePath: string): PathResolution {
  if (!raw.trim()) return { resolved: "", rejected: false };
  const candidate = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(workspacePath, raw);

  if (isWithinAnyAllowedRoot(candidate)) {
    return { resolved: candidate, rejected: false };
  }

  const parent = path.dirname(candidate);
  if (path.isAbsolute(candidate) && fs.existsSync(parent)) {
    return { resolved: candidate, rejected: false };
  }

  const roots = allowedWorkspaceRoots();
  const reason = path.isAbsolute(candidate)
    ? `Parent directory "${parent}" does not exist and path is not under allowed roots: ${roots.join(", ")}`
    : `Path is not under allowed roots: ${roots.join(", ")}`;

  return { resolved: null, rejected: true, reason };
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function readOptionalFileText(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

export function normalizeSourceUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function persistSpec(
  specSaveDir: string,
  project: string,
  generatedSpec: string,
): { specFile: string; specMode: "created" | "updated" | "unchanged" } {
  ensureDir(specSaveDir);
  const specFile = path.join(specSaveDir, `${project}.spec.ts`);
  const beforeContent = readOptionalFileText(specFile);
  fs.writeFileSync(specFile, generatedSpec);
  const specMode = beforeContent === null ? "created" : beforeContent === generatedSpec ? "unchanged" : "updated";
  return { specFile, specMode };
}

export function persistTests(
  testSaveDir: string,
  project: string,
  generatedTestConfig: DiscovererTestConfig,
): {
  testCasesFile: string;
  testsMode: "created" | "merged" | "unchanged" | "skipped";
  effectiveTestConfig: DiscovererTestConfig;
  testsMerge?: DiscovererMergeReport;
  error?: string;
} {
  ensureDir(testSaveDir);
  const testCasesFile = path.join(testSaveDir, `${project}.json`);

  if (fs.existsSync(testCasesFile)) {
    let existingRaw: unknown;
    try {
      existingRaw = JSON.parse(fs.readFileSync(testCasesFile, "utf-8"));
    } catch {
      return {
        testCasesFile,
        testsMode: "unchanged",
        effectiveTestConfig: generatedTestConfig,
        error: "Existing Discoverer test config is not valid JSON and was not replaced",
      };
    }

    const merged = mergeDiscovererTestConfig(existingRaw, generatedTestConfig);
    if (!merged) {
      return {
        testCasesFile,
        testsMode: "unchanged",
        effectiveTestConfig: generatedTestConfig,
        error: "Existing Discoverer test config is incompatible and was not replaced",
      };
    }

    fs.writeFileSync(testCasesFile, JSON.stringify(merged.config, null, 2));
    return {
      testCasesFile,
      testsMode: merged.report.mode,
      effectiveTestConfig: merged.config,
      testsMerge: merged.report,
    };
  }

  fs.writeFileSync(testCasesFile, JSON.stringify(generatedTestConfig, null, 2));
  return {
    testCasesFile,
    testsMode: "created",
    effectiveTestConfig: generatedTestConfig,
  };
}

export function persistDocs(
  project: string,
  agentDocs: string,
  workspacePath: string,
  docsSaveDir?: string,
): { knowledgeFile: string; docsMode: "created" | "appended" | "unchanged" | "skipped" } {
  const knowledge = writeKnowledge(project, agentDocs, workspacePath, docsSaveDir);
  return { knowledgeFile: knowledge.filePath, docsMode: knowledge.mode };
}

export function recordHistory(input: {
  project: string;
  workspacePath: string;
  generationTarget: DiscoverGenerationTarget;
  generationModel: string;
  generationWarning?: string;
  specFile?: string;
  specBeforeContent?: string | null;
  testCasesFile?: string;
  testsBeforeContent?: string | null;
  knowledgeFile?: string;
  docsBeforeContent?: string | null;
  persistTestsEnabled: boolean;
  persistDocsEnabled: boolean;
}) {
  return recordDiscovererHistory({
    project: input.project,
    workspacePath: input.workspacePath,
    generationTarget: input.generationTarget,
    generationModel: input.generationModel,
    generationWarning: input.generationWarning,
    spec: input.specFile
      ? { path: input.specFile, beforeContent: input.specBeforeContent ?? null }
      : undefined,
    tests: input.persistTestsEnabled && input.testCasesFile
      ? { path: input.testCasesFile, beforeContent: input.testsBeforeContent ?? null }
      : undefined,
    docs: input.persistDocsEnabled && input.knowledgeFile
      ? { path: input.knowledgeFile, beforeContent: input.docsBeforeContent ?? null }
      : undefined,
  });
}
