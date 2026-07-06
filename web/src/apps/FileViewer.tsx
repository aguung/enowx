import { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import { ArrowLeft } from "lucide-react";
import { filesApi } from "../lib/api";
import { AppShell } from "./shell";

const langByExt: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  go: "go", py: "python", rs: "rust", java: "java", c: "c", h: "c", cpp: "cpp",
  cs: "csharp", rb: "ruby", php: "php", sh: "shell", bash: "shell", zsh: "shell",
  json: "json", yaml: "yaml", yml: "yaml", toml: "ini", ini: "ini",
  md: "markdown", html: "html", css: "css", scss: "scss", sql: "sql",
  xml: "xml", dockerfile: "dockerfile",
};

function langFor(name: string): string {
  if (name.toLowerCase() === "dockerfile") return "dockerfile";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return langByExt[ext] ?? "plaintext";
}

// FileViewer is an in-app page (with a Back button) that previews a file: text
// via Monaco (read-only), images inline. Shown inside the Files app, not a modal.
export function FileViewer({
  path,
  name,
  kind,
  onBack,
}: {
  path: string;
  name: string;
  kind: "text" | "image";
  onBack: () => void;
}) {
  const [content, setContent] = useState<string>("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(kind === "text");

  useEffect(() => {
    if (kind !== "text") return;
    let alive = true;
    setLoading(true);
    filesApi
      .read(path)
      .then((f) => {
        if (!alive) return;
        if (f.binary) setError("Binary file — preview unavailable.");
        else setContent(f.content);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "failed to read"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, kind]);

  return (
    // flush + h-full so the Monaco editor (height:100%) has a real height to fill;
    // rendered standalone (outside the Files list), it needs its own shell.
    <AppShell title="Files" subtitle="Local file browser" flush>
    <div className="flex h-full min-h-0 flex-1 flex-col p-3">
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-white/55">{path}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-[#0b0c10]">
        {kind === "image" ? (
          <div className="flex h-full items-center justify-center overflow-auto p-4">
            <img src={`/api/files/raw?path=${encodeURIComponent(path)}`} alt={name} className="max-h-full max-w-full object-contain" />
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center text-xs text-white/40">Loading…</div>
        ) : error ? (
          <div className="flex h-full items-center justify-center text-xs text-white/40">{error}</div>
        ) : (
          <Editor
            height="100%"
            theme="vs-dark"
            language={langFor(name)}
            value={content}
            options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12, scrollBeyondLastLine: false, automaticLayout: true }}
          />
        )}
      </div>
    </div>
    </AppShell>
  );
}
