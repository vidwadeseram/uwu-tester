import { readSettings } from "@/app/lib/settings";
import fs from "fs";
import path from "path";
import os from "os";

export function getGitToken(): string {
  return readSettings().github_token || "";
}

export function getGitEnv(): NodeJS.ProcessEnv {
  const token = getGitToken();
  if (!token) return { ...process.env };

  const askpassScript = path.join(os.tmpdir(), "uwu-git-askpass.sh");
  fs.writeFileSync(askpassScript, `#!/bin/sh\necho "${token}"\n`, { mode: 0o700 });

  return {
    ...process.env,
    GIT_ASKPASS: askpassScript,
    GIT_TERMINAL_PROMPT: "0",
  };
}

export function injectTokenIntoUrl(url: string, token: string): string {
  if (!token) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" && !parsed.username) {
      parsed.username = "x-access-token";
      parsed.password = token;
      return parsed.toString();
    }
  } catch {
    if (url.startsWith("https://") && !url.includes("@")) {
      return url.replace("https://", `https://x-access-token:${token}@`);
    }
  }
  return url;
}
