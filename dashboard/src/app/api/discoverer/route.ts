import { NextRequest, NextResponse } from "next/server";
import path from "path";
import {
  collectWorkspaceContext,
  allowedWorkspaceRoots,
  inferProjectSlugFromWorkspace,
  resolveWorkspacePath,
  resolveKnowledgeFilePath,
  safeProjectSlug,
} from "@/app/lib/discoverer";
import type { DiscovererTestConfig, DiscovererMergeReport } from "@/app/lib/discoverer";
import { createDiscovererLogger } from "@/app/lib/discoverer/logger";
import type { DiscovererRequest, FetchedWebContext } from "@/app/lib/discoverer/types";
import { fetchWebContext } from "@/app/lib/discoverer/route-discovery";
import {
  deterministicConfig,
  generateWithModel,
  generateSpecWithModel,
  generateWithCli,
  generateSpecWithCli,
  trimErrorMessage,
} from "@/app/lib/discoverer/spec-generation";
import {
  normalizeSourceUrl,
  resolvePersistPathWithReason,
  readOptionalFileText,
  persistSpec,
  persistTests,
  persistDocs,
  recordHistory,
} from "@/app/lib/discoverer/spec-persistence";

export const dynamic = "force-dynamic";

const REGRESSION_DIR = path.join(process.cwd(), "..", "regression_tests");
const TEST_CASES_DIR = path.join(REGRESSION_DIR, "test_cases");
const DISCOVERER_SPECS_DIR = path.join(REGRESSION_DIR, "specs");

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

  const parsed = body as DiscovererRequest;

  if (parsed.workspacePath !== undefined && typeof parsed.workspacePath !== "string") {
    return NextResponse.json({ error: "workspacePath must be a string" }, { status: 400 });
  }
  if (parsed.project !== undefined && typeof parsed.project !== "string") {
    return NextResponse.json({ error: "project must be a string" }, { status: 400 });
  }
  if (parsed.sourceUrl !== undefined && typeof parsed.sourceUrl !== "string") {
    return NextResponse.json({ error: "sourceUrl must be a string" }, { status: 400 });
  }
  if (parsed.persistTests !== undefined && typeof parsed.persistTests !== "boolean") {
    return NextResponse.json({ error: "persistTests must be a boolean" }, { status: 400 });
  }
  if (parsed.persistDocs !== undefined && typeof parsed.persistDocs !== "boolean") {
    return NextResponse.json({ error: "persistDocs must be a boolean" }, { status: 400 });
  }
  if (parsed.specSavePath !== undefined && typeof parsed.specSavePath !== "string") {
    return NextResponse.json({ error: "specSavePath must be a string" }, { status: 400 });
  }
  if (parsed.testSavePath !== undefined && typeof parsed.testSavePath !== "string") {
    return NextResponse.json({ error: "testSavePath must be a string" }, { status: 400 });
  }
  if (parsed.docsSavePath !== undefined && typeof parsed.docsSavePath !== "string") {
    return NextResponse.json({ error: "docsSavePath must be a string" }, { status: 400 });
  }

  const workspacePath = (parsed.workspacePath ?? "").trim();
  if (!workspacePath) {
    return NextResponse.json({ error: "workspacePath required" }, { status: 400 });
  }

  const normalizedWorkspace = resolveWorkspacePath(workspacePath);
  if (!normalizedWorkspace) {
    const roots = allowedWorkspaceRoots();
    return NextResponse.json(
      { error: `workspacePath must be an accessible directory under allowed roots: ${roots.join(", ")}` },
      { status: 400 }
    );
  }

  const explicitProject = (parsed.project ?? "").trim();
  const project = safeProjectSlug(explicitProject || inferProjectSlugFromWorkspace(normalizedWorkspace));
  if (!project) {
    return NextResponse.json({ error: "Unable to infer a valid project slug" }, { status: 400 });
  }

  const sourceUrl = normalizeSourceUrl(parsed.sourceUrl ?? "");
  if (!sourceUrl) {
    return NextResponse.json({ error: "sourceUrl (http/https) is required for Discoverer" }, { status: 400 });
  }

  const shouldPersistTests = parsed.persistTests !== false;
  const shouldPersistDocs = parsed.persistDocs !== false;
  const specSavePath = (parsed.specSavePath ?? "").trim();
  const testSavePath = (parsed.testSavePath ?? "").trim();
  const docsSavePath = (parsed.docsSavePath ?? "").trim();
  const generationTarget = parsed.generationTarget ?? "api";

  if (generationTarget !== "api" && generationTarget !== "claude" && generationTarget !== "opencode") {
    return NextResponse.json({ error: "generationTarget must be api|claude|opencode" }, { status: 400 });
  }

  const { logs, log } = createDiscovererLogger();

  const specPathRes = resolvePersistPathWithReason(specSavePath, normalizedWorkspace);
  const testPathRes = resolvePersistPathWithReason(testSavePath, normalizedWorkspace);
  const docsPathRes = resolvePersistPathWithReason(docsSavePath, normalizedWorkspace);

  if (specSavePath && specPathRes.rejected) {
    log("persist", "Path rejected for specSavePath", { path: specSavePath, reason: specPathRes.reason });
    return NextResponse.json(
      { error: `specSavePath must be under allowed roots: ${allowedWorkspaceRoots().join(", ")}` },
      { status: 400 }
    );
  }

  if (testSavePath && testPathRes.rejected) {
    log("persist", "Path rejected for testSavePath", { path: testSavePath, reason: testPathRes.reason });
    return NextResponse.json(
      { error: `testSavePath must be under allowed roots: ${allowedWorkspaceRoots().join(", ")}` },
      { status: 400 }
    );
  }

  if (docsSavePath && docsPathRes.rejected) {
    log("persist", "Path rejected for docsSavePath", { path: docsSavePath, reason: docsPathRes.reason });
    return NextResponse.json(
      { error: `docsSavePath must be under allowed roots: ${allowedWorkspaceRoots().join(", ")}` },
      { status: 400 }
    );
  }

  const resolvedSpecSavePath = specPathRes.resolved;
  const resolvedTestSavePath = testPathRes.resolved;
  const resolvedDocsSavePath = docsPathRes.resolved;

  const specSaveDir = resolvedSpecSavePath || DISCOVERER_SPECS_DIR;
  const testSaveDir = resolvedTestSavePath || TEST_CASES_DIR;

  log("init", "Selected output directories", { specSaveDir, testSaveDir, docsSaveDir: resolvedDocsSavePath || "default" });
  log("init", "Normalized baseURL", { sourceUrl });

  const context = collectWorkspaceContext(normalizedWorkspace);
  log("scan", "Workspace scanned", {
    project,
    workspaceName: context.workspaceName,
    fileCount: context.fileCount,
    routeHintCount: context.routeHints.length,
  });

  let fetchedWeb: FetchedWebContext;
  try {
    fetchedWeb = await fetchWebContext(sourceUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Discoverer URL fetch failed: ${trimErrorMessage(message, 900)}` }, { status: 503 });
  }
  log("fetch", "Web context fetched", { finalUrl: fetchedWeb.finalUrl, status: fetchedWeb.status, title: fetchedWeb.title });

  let generatedTestConfig: DiscovererTestConfig;
  let agentDocs: string;
  let generatedSpec = "";
  let specModel = "";
  let generationModel = "";
  let generationWarning = "";

  try {
    const specGenerated = generationTarget === "api"
      ? await generateSpecWithModel(project, sourceUrl, context, fetchedWeb)
      : await generateSpecWithCli(generationTarget, project, sourceUrl, context, fetchedWeb);
    generatedSpec = specGenerated.spec;
    specModel = specGenerated.model;
    log("generate", "Spec generation completed", { model: specModel });
  } catch {
    const deterministic = deterministicConfig(project, sourceUrl, context, fetchedWeb);
    generatedSpec = deterministic.spec;
    specModel = deterministic.specModel;
    generationWarning = generationWarning
      ? `${generationWarning} | ${deterministic.warning}`
      : deterministic.warning;
    log("generate", "Spec generation fallback to deterministic", { reason: deterministic.warning });
  }

  try {
    const generated = generationTarget === "api"
      ? await generateWithModel(project, context, { sourceUrl, spec: generatedSpec, webContext: fetchedWeb })
      : await generateWithCli(generationTarget, project, context, { sourceUrl, spec: generatedSpec, webContext: fetchedWeb });
    generatedTestConfig = generated.testConfig;
    agentDocs = generated.agentDocs;
    generationModel = generated.model;
    log("generate", "Generation completed", { model: generationModel, testCaseCount: generatedTestConfig.test_cases.length, workflowCount: generatedTestConfig.workflows.length });
  } catch {
    const deterministic = deterministicConfig(project, sourceUrl, context, fetchedWeb);
    generatedTestConfig = deterministic.testConfig;
    agentDocs = deterministic.agentDocs;
    generationModel = deterministic.generationModel;
    generationWarning = generationWarning
      ? `${generationWarning} | ${deterministic.warning}`
      : deterministic.warning;
    log("generate", "Generation fallback to deterministic", { reason: deterministic.warning });
  }

  let effectiveTestConfig = generatedTestConfig;

  const targetSpecFile = path.join(specSaveDir, `${project}.spec.ts`);
  const targetTestsFile = shouldPersistTests ? path.join(testSaveDir, `${project}.json`) : "";
  const specBeforeContent = readOptionalFileText(targetSpecFile);
  const testsBeforeContent = targetTestsFile ? readOptionalFileText(targetTestsFile) : null;
  let docsBeforeContent: string | null = null;

  const { specFile, specMode } = persistSpec(specSaveDir, project, generatedSpec);
  log("persist", "Spec file written", { path: specFile, mode: specMode });

  let testCasesFile = "";
  let testsMode: "created" | "merged" | "unchanged" | "skipped" = "skipped";
  let testsMerge: DiscovererMergeReport | undefined;

  if (shouldPersistTests) {
    const result = persistTests(testSaveDir, project, generatedTestConfig);
    testCasesFile = result.testCasesFile;
    testsMode = result.testsMode;
    testsMerge = result.testsMerge;
    effectiveTestConfig = result.effectiveTestConfig;

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }
  }

  let knowledgeFile = "";
  let docsMode: "created" | "appended" | "unchanged" | "skipped" = "skipped";

  if (shouldPersistDocs) {
    const targetDocsFile = resolveKnowledgeFilePath(project, resolvedDocsSavePath || undefined);
    docsBeforeContent = readOptionalFileText(targetDocsFile);
    const result = persistDocs(project, agentDocs, normalizedWorkspace, resolvedDocsSavePath || undefined);
    knowledgeFile = result.knowledgeFile;
    docsMode = result.docsMode;
  }

  const historyEntry = recordHistory({
    project,
    workspacePath: normalizedWorkspace,
    generationTarget,
    generationModel,
    generationWarning: generationWarning || undefined,
    specFile,
    specBeforeContent,
    testCasesFile: testCasesFile || undefined,
    testsBeforeContent,
    knowledgeFile: knowledgeFile || undefined,
    docsBeforeContent,
    persistTestsEnabled: shouldPersistTests,
    persistDocsEnabled: shouldPersistDocs,
  });

  log("complete", "Discoverer run complete", { project, specMode, testsMode, docsMode });

  return NextResponse.json({
    project,
    workspacePath: normalizedWorkspace,
    sourceUrl,
    testConfig: effectiveTestConfig,
    spec: generatedSpec,
    agentDocs,
    context: {
      workspaceName: context.workspaceName,
      fileCount: context.fileCount,
      stackHints: context.stackHints,
      runScripts: context.runScripts,
      routeHints: context.routeHints,
    },
    persisted: {
      tests: shouldPersistTests,
      docs: shouldPersistDocs,
      specFile: specFile || undefined,
      specMode,
      testCasesFile: testCasesFile || undefined,
      knowledgeFile: knowledgeFile || undefined,
      testsMode,
      docsMode,
      testsMerge,
      generationModel,
      specModel,
      generationWarning: generationWarning || undefined,
      historyId: historyEntry?.id,
      logs,
    },
  });
}
