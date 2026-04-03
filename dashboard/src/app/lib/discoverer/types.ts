import type { DiscovererCase, DiscovererWorkflow, DiscovererTestConfig } from "@/app/lib/discoverer";

export interface DiscovererRequest {
  workspacePath?: string;
  project?: string;
  sourceUrl?: string;
  persistTests?: boolean;
  persistDocs?: boolean;
  specSavePath?: string;
  testSavePath?: string;
  docsSavePath?: string;
  generationTarget?: "api" | "claude" | "opencode";
}

export interface DeterministicGeneration {
  spec: string;
  testConfig: DiscovererTestConfig;
  agentDocs: string;
  specModel: string;
  generationModel: string;
  warning: string;
}

export interface DiscovererAiOutput {
  description: string;
  test_cases: DiscovererCase[];
  workflows: DiscovererWorkflow[];
  agent_docs: string;
}

export interface CliRunResult {
  stdout: string;
  stderr: string;
  code: number;
  errorMessage?: string;
}

export interface FetchedWebContext {
  finalUrl: string;
  status: number;
  title: string;
  description: string;
  headings: string[];
  links: string[];
  excerpt: string;
}

export interface DiscovererLog {
  timestamp: string;
  phase: "init" | "scan" | "fetch" | "generate" | "persist" | "complete";
  message: string;
  data?: Record<string, unknown>;
}

// Re-export known types from the core discoverer module for convenience
export type { DiscovererCase, DiscovererWorkflow, DiscovererTestConfig } from "@/app/lib/discoverer";
