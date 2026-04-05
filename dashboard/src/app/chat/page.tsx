"use client";

import { useEffect, useRef, useState } from "react";
import FolderTreePicker from "../components/FolderTreePicker";

interface Message {
  role: "user" | "assistant";
  content: string;
}

function MarkdownText({ text }: { text: string }) {
  // Simple markdown rendering for code blocks and inline code
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("```") && part.endsWith("```")) {
          const inner = part.slice(3, -3);
          const newlineIdx = inner.indexOf("\n");
          const lang = newlineIdx > -1 ? inner.slice(0, newlineIdx).trim() : "";
          const code = newlineIdx > -1 ? inner.slice(newlineIdx + 1) : inner;
          return (
            <pre
              key={i}
              className="rounded-lg p-3 my-2 overflow-x-auto text-xs leading-relaxed"
              style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
            >
              {lang && (
                <div className="text-xs mb-2 font-mono" style={{ color: "var(--dim)" }}>
                  {lang}
                </div>
              )}
              <code>{code.trimEnd()}</code>
            </pre>
          );
        } else if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code
              key={i}
              className="px-1.5 py-0.5 rounded text-xs font-mono"
              style={{ background: "var(--bg)", color: "var(--cyan)", border: "1px solid var(--border)" }}
            >
              {part.slice(1, -1)}
            </code>
          );
        } else {
          // Handle newlines
          return (
            <span key={i}>
              {part.split("\n").map((line, j, arr) => (
                <span key={j}>
                  {line}
                  {j < arr.length - 1 && <br />}
                </span>
              ))}
            </span>
          );
        }
      })}
    </>
  );
}

function ChatBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      {!isUser && (
        <div
          className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0 mr-2 mt-0.5"
          style={{ background: "linear-gradient(135deg,#00ff88,#00d4ff)" }}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="#0a0e1a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a10 10 0 1 0 10 10" /><path d="M12 6v6l4 2" />
          </svg>
        </div>
      )}
      <div
        className="max-w-[92%] sm:max-w-[80%] rounded-2xl px-3 sm:px-4 py-3 text-sm leading-relaxed"
        style={
          isUser
            ? { background: "rgba(0,212,255,0.15)", border: "1px solid rgba(0,212,255,0.3)", color: "var(--text)", borderRadius: "18px 18px 4px 18px" }
            : { background: "var(--card)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: "18px 18px 18px 4px" }
        }
      >
        <MarkdownText text={msg.content} />
      </div>
      {isUser && (
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ml-2 mt-0.5"
          style={{ background: "rgba(0,212,255,0.2)", border: "1px solid rgba(0,212,255,0.3)" }}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="#00d4ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
          </svg>
        </div>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start mb-4">
      <div
        className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0 mr-2 mt-0.5"
        style={{ background: "linear-gradient(135deg,#00ff88,#00d4ff)" }}
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="#0a0e1a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a10 10 0 1 0 10 10" /><path d="M12 6v6l4 2" />
        </svg>
      </div>
      <div
        className="rounded-2xl px-4 py-3 flex items-center gap-1"
        style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "18px 18px 18px 4px" }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-2 h-2 rounded-full"
            style={{
              background: "#00ff88",
              animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

const SUGGESTIONS = [
  "How do I set up a reverse proxy with nginx?",
  "Write a bash script to backup a directory",
  "Explain how systemd services work",
  "How do I check disk usage on Linux?",
  "Debug this: my Node.js app keeps crashing",
  "What's the best way to monitor VPS performance?",
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function sendMessage(content: string) {
    if (!content.trim() || loading) return;
    setError("");

    const userMsg: Message = { role: "user", content: content.trim() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updated, workspacePath: workspacePath || undefined }),
      });
      const data = await res.json();
      if (res.ok && data.message) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.message }]);
      } else {
        setError(data.error || "Failed to get response");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function clearChat() {
    setMessages([]);
    setError("");
    inputRef.current?.focus();
  }

  async function handleFileAttach(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

    if (ext === "xlsx" || ext === "xls") {
      try {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const parts: string[] = [];
        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName];
          const csv = XLSX.utils.sheet_to_csv(ws);
          parts.push(`[Sheet: ${sheetName}]\n${csv}`);
        }
        const content = `📎 ${file.name}:\n\`\`\`\n${parts.join("\n\n")}\n\`\`\``;
        setInput((prev) => prev ? `${prev}\n\n${content}` : content);
      } catch {
        setError("Failed to read Excel file");
      }
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        const content = `📎 ${file.name}:\n\`\`\`\n${text}\n\`\`\``;
        setInput((prev) => prev ? `${prev}\n\n${content}` : content);
      };
      reader.readAsText(file);
    }
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-[calc(100dvh-3.5rem)] min-h-[calc(100dvh-3.5rem)] fade-in" style={{ background: "var(--bg)" }}>
      {/* Header */}
      <div
        className="flex-shrink-0 px-3 sm:px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 w-full sm:w-auto">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#00ff88,#00d4ff)" }}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="#0a0e1a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a10 10 0 1 0 10 10" /><path d="M12 6v6l4 2" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-semibold" style={{ color: "#00ff88" }}>openclaw</div>
            <div className="text-xs" style={{ color: "var(--dim)" }}>AI assistant · VPS dev helper</div>
          </div>
          <div className="flex items-center gap-1.5 ml-2">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#00ff88", boxShadow: "0 0 6px #00ff88" }} />
            <span className="text-xs" style={{ color: "#00ff88" }}>online</span>
          </div>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
          <FolderTreePicker
            value={workspacePath}
            onSelect={setWorkspacePath}
            compact
            placeholder="Workspace context"
          />

          {!isEmpty && (
            <button
              onClick={clearChat}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors"
              style={{ background: "var(--btn-bg)", color: "var(--dim)", border: "1px solid var(--border)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--dim)")}
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
              </svg>
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-5 sm:py-6">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full gap-8">
            <div className="text-center">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{ background: "linear-gradient(135deg,rgba(0,255,136,0.15),rgba(0,212,255,0.15))", border: "1px solid rgba(0,255,136,0.2)" }}
              >
                <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="#00ff88" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a10 10 0 1 0 10 10" /><path d="M12 6v6l4 2" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold mb-1" style={{ color: "var(--text)" }}>Chat with openclaw</h2>
              <p className="text-sm" style={{ color: "var(--dim)" }}>Ask anything about coding, servers, debugging, or VPS management.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="text-left px-4 py-3 rounded-xl text-xs transition-all"
                  style={{ background: "var(--btn-bg)", border: "1px solid var(--border)", color: "var(--dim)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "#00ff8840";
                    e.currentTarget.style.color = "var(--text)";
                    e.currentTarget.style.background = "rgba(0,255,136,0.05)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.color = "var(--dim)";
                    e.currentTarget.style.background = "var(--btn-bg)";
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto">
            {messages.map((msg, i) => (
              <ChatBubble key={i} msg={msg} />
            ))}
            {loading && <TypingIndicator />}
            {error && (
              <div className="flex justify-center mb-4">
                <div
                  className="px-4 py-2 rounded-lg text-xs"
                  style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" }}
                >
                  {error}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
        {isEmpty && <div ref={bottomRef} />}
      </div>

      {/* Input */}
      <div
        className="flex-shrink-0 px-3 sm:px-4 py-3 border-t"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <div className="max-w-3xl mx-auto">
          {error && !isEmpty && null}
          <div
            className="flex items-end gap-3 rounded-2xl px-4 py-3"
            style={{ background: "var(--btn-bg)", border: "1px solid var(--border)" }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.csv,.xlsx,.xls"
              className="hidden"
              onChange={handleFileAttach}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              title="Attach file (.txt, .csv, .xlsx)"
              className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-opacity disabled:opacity-40"
              style={{ color: "var(--dim)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--dim)")}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask openclaw anything… attach a file or Enter to send"
              rows={1}
              className="flex-1 bg-transparent resize-none outline-none text-sm leading-relaxed"
              style={{
                color: "var(--text)",
                minHeight: "24px",
                maxHeight: "160px",
                overflowY: "auto",
              }}
              onInput={(e) => {
                const t = e.currentTarget;
                t.style.height = "auto";
                t.style.height = Math.min(t.scrollHeight, 160) + "px";
              }}
              disabled={loading}
              autoFocus
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all"
              style={{
                background: input.trim() && !loading ? "linear-gradient(135deg,#00ff88,#00d4ff)" : "var(--btn-bg)",
                color: input.trim() && !loading ? "#0a0e1a" : "var(--dim)",
              }}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <p className="text-center text-xs mt-2" style={{ color: "var(--dim)", opacity: 0.6 }}>
            openclaw uses OpenRouter · Anthropic · OpenAI — configure keys in{" "}
            <a href="/settings" className="hover:underline" style={{ color: "var(--dim)" }}>Settings</a>
          </p>
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-6px); }
        }
      `}</style>

    </div>
  );
}
