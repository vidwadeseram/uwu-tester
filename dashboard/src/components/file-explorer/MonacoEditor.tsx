"use client";

import Editor from "@monaco-editor/react";
import { useTheme } from "next-themes";

interface MonacoEditorProps {
  value: string;
  onChange: (value: string | undefined) => void;
  path?: string;
  readOnly?: boolean;
}

function getLanguageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const langMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    md: "markdown",
    css: "css",
    scss: "scss",
    html: "html",
    py: "python",
    go: "go",
    rs: "rust",
    rb: "ruby",
    java: "java",
    c: "c",
    cpp: "cpp",
    cs: "csharp",
    php: "php",
    sh: "shell",
    bash: "shell",
    yaml: "yaml",
    yml: "yaml",
    xml: "xml",
    sql: "sql",
  };
  return langMap[ext] || "plaintext";
}

export default function MonacoEditor({ value, onChange, path = "", readOnly = false }: MonacoEditorProps) {
  const { resolvedTheme } = useTheme();
  const language = getLanguageFromPath(path);

  return (
    <Editor
      height="100%"
      language={language}
      value={value}
      onChange={onChange}
      theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
      options={{
        readOnly,
        minimap: { enabled: true },
        fontSize: 13,
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: "on",
        padding: { top: 8 },
      }}
    />
  );
}