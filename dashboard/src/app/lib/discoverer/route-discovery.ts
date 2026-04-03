import { collectWorkspaceContext } from "@/app/lib/discoverer";
import { FetchedWebContext } from "./types";
 
import path from "path";

export type CoverageRoute = {
  path: string;
  source: "workspace_hint" | "web_crawl" | "speculative";
};

export function normalizeForCompare(input: string): string {
  return path.resolve(input).replace(/\\+/g, "/").replace(/\/+$/, "");
}

export function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractFirstMatch(html: string, regex: RegExp): string {
  const match = html.match(regex);
  if (!match?.[1]) return "";
  return stripTags(match[1]).slice(0, 240);
}

export function extractHeadings(html: string): string[] {
  const headings: string[] = [];
  const regex = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let match = regex.exec(html);
  while (match && headings.length < 12) {
    const value = stripTags(match[1]);
    if (value) headings.push(value.slice(0, 180));
    match = regex.exec(html);
  }
  return headings;
}

export function extractLinks(html: string): string[] {
  const links: string[] = [];
  const regex = /<a[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match = regex.exec(html);
  while (match && links.length < 20) {
    const href = (match[1] ?? "").trim();
    if (href) links.push(href.slice(0, 280));
    match = regex.exec(html);
  }
  return Array.from(new Set(links));
}

export async function fetchWebContext(sourceUrl: string): Promise<FetchedWebContext> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(sourceUrl, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "user-agent": "uwu-code-discoverer/1.0",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    const html = await res.text();
    const title = extractFirstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const description = extractFirstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i);
    const excerpt = stripTags(html).slice(0, 3000);
    return {
      finalUrl: res.url,
      status: res.status,
      title,
      description,
      headings: extractHeadings(html),
      links: extractLinks(html),
      excerpt,
    };
  } catch (e) {
    throw new Error("Failed to fetch source URL content");
  } finally {
    clearTimeout(timeout);
  }
}

export function webContextBlock(web: FetchedWebContext): string {
  return [
    "Fetched web URL context:",
    JSON.stringify({ finalUrl: web.finalUrl, status: web.status, title: web.title, description: web.description, headings: web.headings, links: web.links, excerpt: web.excerpt }, null, 2),
  ].join("\n");
}

export function toCoveragePath(raw: string, sourceUrl: string): string | null {
  const input = (raw || "").trim();
  if (!input) return null;
  let pathname = "";
  if (input.startsWith("http://") || input.startsWith("https://")) {
    try {
      const parsed = new URL(input);
      const base = new URL(sourceUrl || "http://localhost:3000");
      if (parsed.origin !== base.origin) return null;
      pathname = parsed.pathname || "/";
    } catch {
      return null;
    }
  } else if (input.startsWith("/")) {
    pathname = input;
  } else {
    return null;
  }

  const normalized = pathname.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  const lowered = normalized.toLowerCase();
  if (lowered.startsWith("/api/")) return null;
  if (lowered === "/api") return null;
  if (/(\.png|\.jpg|\.jpeg|\.gif|\.svg|\.webp|\.ico|\.css|\.js|\.map|\.woff|\.woff2|\.ttf|\.otf|\.json)$/i.test(lowered)) return null;
  if (lowered.includes("logout") || lowered.includes("signout")) return null;
  return normalized;
}

export function buildCoverageRoutes(
  sourceUrl: string,
  context: ReturnType<typeof collectWorkspaceContext>,
  web: FetchedWebContext,
): CoverageRoute[] {
  const out: CoverageRoute[] = [];
  const seen = new Set<string>();
  const addRoute = (value: string, source: CoverageRoute["source"]) => {
    const normalized = toCoveragePath(value, sourceUrl);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push({ path: normalized, source });
  };
  addRoute("/", "workspace_hint");
  for (const route of context.routeHints) addRoute(route, "workspace_hint");
  for (const link of web.links) addRoute(link, "web_crawl");
  for (const authRoute of ["/login", "/signin", "/signup", "/forgot-password", "/verify", "/otp"]) addRoute(authRoute, "speculative");
  return out;
}

export function compactWorkspaceContext(
  ctx: ReturnType<typeof collectWorkspaceContext>,
  limits?: { runScripts?: number; routeHints?: number; sampledFiles?: number; keyFiles?: number }
) {
  const runScriptsLimit = limits?.runScripts ?? 20;
  const routeHintsLimit = limits?.routeHints ?? 40;
  const sampledFilesLimit = limits?.sampledFiles ?? 160;
  const keyFilesLimit = limits?.keyFiles ?? 12;
  return {
    workspaceName: ctx.workspaceName,
    workspacePath: ctx.workspacePath,
    fileCount: ctx.fileCount,
    stackHints: ctx.stackHints,
    runScripts: ctx.runScripts.slice(0, runScriptsLimit),
    routeHints: ctx.routeHints.slice(0, routeHintsLimit),
    sampledFiles: ctx.sampledFiles.slice(0, sampledFilesLimit),
    keyFiles: ctx.keyFiles.slice(0, keyFilesLimit),
  };
}
