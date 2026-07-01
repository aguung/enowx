import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Plus, Trash2, Loader2, Zap } from "lucide-react";
import { keysApi } from "../lib/api";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
interface Header {
  key: string;
  value: string;
  on: boolean;
}

const METHODS: Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

// Presets for the local gateway so testing common endpoints is one click.
const PRESETS: { label: string; method: Method; url: string; body?: string }[] = [
  {
    label: "Chat Completions",
    method: "POST",
    url: "/v1/chat/completions",
    body: JSON.stringify({ model: "cb/gemini-3.1-pro", stream: false, messages: [{ role: "user", content: "hi" }] }, null, 2),
  },
  {
    label: "Anthropic Messages",
    method: "POST",
    url: "/anthropic/v1/messages",
    body: JSON.stringify({ model: "cb/claude-sonnet-4.5", max_tokens: 64, messages: [{ role: "user", content: "hi" }] }, null, 2),
  },
  { label: "List accounts", method: "GET", url: "/api/accounts" },
  { label: "List models", method: "GET", url: "/api/models" },
];

// ApiTestApp is a Postman-style request builder. The URL is free-form (relative
// paths hit this gateway; absolute URLs go anywhere). Streaming (SSE) responses
// are shown incrementally.
export function ApiTestApp() {
  const [method, setMethod] = useState<Method>("POST");
  const [url, setUrl] = useState("/v1/chat/completions");
  const [headers, setHeaders] = useState<Header[]>([{ key: "Content-Type", value: "application/json", on: true }]);
  const [body, setBody] = useState(PRESETS[0].body ?? "");
  const [tab, setTab] = useState<"body" | "headers">("body");
  const [apiKey, setApiKey] = useState("");

  const [busy, setBusy] = useState(false);
  const [resStatus, setResStatus] = useState<number | null>(null);
  const [resTime, setResTime] = useState<number | null>(null);
  const [resBody, setResBody] = useState("");
  const [resHeaders, setResHeaders] = useState<[string, string][]>([]);
  const [err, setErr] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    keysApi
      .list()
      .then((keys) => {
        const k = keys.find((x) => x.enabled && x.secret);
        if (k) setApiKey(k.secret);
      })
      .catch(() => {});
  }, []);

  const bodyAllowed = method !== "GET" && method !== "DELETE";
  const isLocal = useMemo(() => url.startsWith("/") || url.includes("localhost") || url.includes("127.0.0.1"), [url]);

  function applyPreset(p: (typeof PRESETS)[number]) {
    setMethod(p.method);
    setUrl(p.url);
    setBody(p.body ?? "");
    setTab(p.body ? "body" : "headers");
    setResStatus(null);
    setResBody("");
  }

  async function send() {
    if (busy) return;
    setErr("");
    setResStatus(null);
    setResBody("");
    setResHeaders([]);
    setResTime(null);
    setBusy(true);

    const h: Record<string, string> = {};
    for (const row of headers) if (row.on && row.key.trim()) h[row.key.trim()] = row.value;
    // Auto-attach the gateway API key for local proxy calls if not set manually.
    if (isLocal && apiKey && !Object.keys(h).some((k) => k.toLowerCase() === "authorization")) {
      h["Authorization"] = `Bearer ${apiKey}`;
    }

    const ac = new AbortController();
    abortRef.current = ac;
    const start = performance.now();
    try {
      const res = await fetch(url, {
        method,
        signal: ac.signal,
        headers: h,
        body: bodyAllowed && body.trim() ? body : undefined,
      });
      setResStatus(res.status);
      setResHeaders([...res.headers.entries()]);
      const ctype = res.headers.get("content-type") ?? "";

      if (ctype.includes("text/event-stream") && res.body) {
        // Stream SSE chunks incrementally.
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          setResBody((prev) => prev + dec.decode(value, { stream: true }));
        }
      } else {
        const text = await res.text();
        // Pretty-print JSON when possible.
        try {
          setResBody(JSON.stringify(JSON.parse(text), null, 2));
        } catch {
          setResBody(text);
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr(e instanceof Error ? e.message : "request failed");
    } finally {
      setResTime(Math.round(performance.now() - start));
      setBusy(false);
      abortRef.current = null;
    }
  }

  const statusColor =
    resStatus == null ? "" : resStatus < 300 ? "text-emerald-400" : resStatus < 400 ? "text-amber-400" : "text-red-400";

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden rounded-2xl border border-white/10 bg-[var(--window-bg)]/80 p-3">
      {/* Presets */}
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => applyPreset(p)}
            className="flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-white/60 hover:border-white/25 hover:text-white"
          >
            <Zap className="h-3 w-3" /> {p.label}
          </button>
        ))}
      </div>

      {/* Method + URL + Send */}
      <div className="flex items-center gap-2">
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as Method)}
          className="rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-xs font-semibold text-white outline-none"
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="/v1/chat/completions or https://…"
          className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white outline-none focus:border-white/25"
        />
        {busy ? (
          <button onClick={() => abortRef.current?.abort()} className="rounded-lg bg-white/10 px-3 py-2 text-xs text-white hover:bg-white/15">
            Stop
          </button>
        ) : (
          <button onClick={send} className="flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-xs font-medium text-black hover:opacity-90">
            <Send className="h-3.5 w-3.5" /> Send
          </button>
        )}
      </div>

      {/* Request tabs */}
      <div className="flex gap-1 border-b border-white/5 text-xs">
        {(["body", "headers"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-2.5 py-1.5 capitalize ${tab === t ? "border-b-2 border-white text-white" : "text-white/45 hover:text-white/80"}`}
          >
            {t}
            {t === "headers" && ` (${headers.filter((x) => x.on).length})`}
          </button>
        ))}
      </div>

      {/* Request editor */}
      <div className="min-h-[110px]">
        {tab === "body" ? (
          bodyAllowed ? (
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              spellCheck={false}
              placeholder="{ }"
              className="h-32 w-full resize-none rounded-lg border border-white/10 bg-black/30 p-2.5 font-mono text-xs text-white outline-none focus:border-white/25"
            />
          ) : (
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-center text-[11px] text-white/40">
              {method} requests have no body.
            </div>
          )
        ) : (
          <div className="space-y-1.5">
            {headers.map((row, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={row.on}
                  onChange={(e) => setHeaders((p) => p.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))}
                  className="accent-white"
                />
                <input
                  value={row.key}
                  onChange={(e) => setHeaders((p) => p.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                  placeholder="Header"
                  className="w-40 rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-[11px] text-white outline-none"
                />
                <input
                  value={row.value}
                  onChange={(e) => setHeaders((p) => p.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  placeholder="Value"
                  className="flex-1 rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-[11px] text-white outline-none"
                />
                <button onClick={() => setHeaders((p) => p.filter((_, j) => j !== i))} className="rounded p-1 text-white/40 hover:text-red-400">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              onClick={() => setHeaders((p) => [...p, { key: "", value: "", on: true }])}
              className="flex items-center gap-1 text-[11px] text-white/50 hover:text-white"
            >
              <Plus className="h-3 w-3" /> Add header
            </button>
            {isLocal && apiKey && (
              <p className="pt-1 text-[10px] text-white/30">Authorization: Bearer &lt;gateway key&gt; is auto-added for local calls.</p>
            )}
          </div>
        )}
      </div>

      {/* Response */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-white/10 bg-black/20">
        <div className="flex items-center gap-3 border-b border-white/5 px-3 py-1.5 text-[11px]">
          <span className="font-medium text-white/50">Response</span>
          {resStatus != null && <span className={`font-mono font-semibold ${statusColor}`}>{resStatus}</span>}
          {resTime != null && <span className="font-mono text-white/40">{resTime} ms</span>}
          {resHeaders.length > 0 && (
            <span className="truncate font-mono text-white/30" title={resHeaders.map(([k, v]) => `${k}: ${v}`).join("\n")}>
              {resHeaders.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? `${resHeaders.length} headers`}
            </span>
          )}
          {busy && <Loader2 className="h-3 w-3 animate-spin text-white/40" />}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {err && <div className="mb-2 rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-300">{err}</div>}
          {resBody ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-white/85">{resBody}</pre>
          ) : (
            !err && <div className="text-center text-[11px] text-white/30">Send a request to see the response.</div>
          )}
        </div>
      </div>
    </div>
  );
}
