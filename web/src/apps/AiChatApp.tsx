import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Trash2, Loader2, Bot, User, ChevronDown } from "lucide-react";
import { accountsApi, keysApi, type ProviderModel } from "../lib/api";
import { Markdown } from "../components/Markdown";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

// AiChatApp is a full chat client against the local gateway. The model list is
// unified across all accounts/providers — the gateway routes a model to an
// account, so there's no account picker here.
export function AiChatApp() {
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [model, setModel] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [apiKey, setApiKey] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    accountsApi
      .allModels()
      .then((r) => {
        const list = (r.models ?? []).filter((m) => m.type !== "image");
        setModels(list);
        setModel((cur) => cur || (list[0]?.model_id ?? ""));
      })
      .catch(() => {});
    // Grab an API key to authenticate the proxy call (if the gateway has one).
    keysApi
      .list()
      .then((keys) => {
        const k = keys.find((x) => x.enabled && x.secret);
        if (k) setApiKey(k.secret);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  const shownModels = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? models.filter((m) => `${m.name} ${m.model_id}`.toLowerCase().includes(f)) : models;
  }, [models, filter]);

  async function send() {
    const text = input.trim();
    if (!text || busy || !model) return;
    setErr("");
    setInput("");
    const history: Msg[] = [...msgs, { role: "user", content: text }];
    setMsgs([...history, { role: "assistant", content: "" }]);
    setBusy(true);

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch("/v1/chat/completions", {
        method: "POST",
        signal: ac.signal,
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          stream: true,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const s = line.trim();
          if (!s.startsWith("data:")) continue;
          const data = s.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const j = JSON.parse(data);
            const delta = j.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              setMsgs((prev) => {
                const next = [...prev];
                next[next.length - 1] = { role: "assistant", content: next[next.length - 1].content + delta };
                return next;
              });
            }
          } catch {
            /* ignore keep-alives / partial frames */
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setErr(e instanceof Error ? e.message : "failed");
        setMsgs((prev) => prev.slice(0, -1)); // drop the empty assistant bubble
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  const stop = () => abortRef.current?.abort();
  const clear = () => {
    stop();
    setMsgs([]);
    setErr("");
  };

  const current = models.find((m) => m.model_id === model);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[var(--window-bg)]/80">
      {/* Header: model picker + clear */}
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
        <div className="relative">
          <button
            onClick={() => setPickerOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs text-white hover:border-white/25"
          >
            <Bot className="h-3.5 w-3.5 text-white/50" />
            <span className="max-w-[220px] truncate">{current?.name || model || "Select model"}</span>
            <ChevronDown className="h-3.5 w-3.5 text-white/40" />
          </button>
          {pickerOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-72 overflow-hidden rounded-xl border border-white/10 bg-[#0e1016] shadow-2xl">
              <input
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter models…"
                className="w-full border-b border-white/5 bg-transparent px-3 py-2 text-xs text-white outline-none placeholder:text-white/30"
              />
              <div className="max-h-60 overflow-y-auto p-1">
                {shownModels.length === 0 && (
                  <div className="px-2 py-3 text-center text-[11px] text-white/40">No models. Add an account first.</div>
                )}
                {shownModels.map((m) => (
                  <button
                    key={m.model_id}
                    onClick={() => {
                      setModel(m.model_id);
                      setPickerOpen(false);
                      setFilter("");
                    }}
                    className={`flex w-full flex-col items-start rounded-lg px-2.5 py-1.5 text-left hover:bg-white/5 ${m.model_id === model ? "bg-white/10" : ""}`}
                  >
                    <span className="truncate text-xs text-white">{m.name}</span>
                    <span className="truncate font-mono text-[10px] text-white/35">{m.model_id}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex-1" />
        <button onClick={clear} title="Clear chat" className="rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {msgs.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center text-white/30">
            <Bot className="mb-2 h-8 w-8" />
            <p className="text-sm">Chat with your gateway models.</p>
            <p className="text-[11px]">Pick a model above and start typing.</p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex gap-2.5 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                m.role === "user" ? "bg-indigo-500/20 text-indigo-300" : "bg-white/10 text-white/60"
              }`}
            >
              {m.role === "user" ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
            </div>
            <div
              className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                m.role === "user" ? "bg-indigo-500/15 text-white" : "bg-white/5 text-white/90"
              }`}
            >
              {m.content ? <Markdown text={m.content} /> : <Loader2 className="h-4 w-4 animate-spin text-white/40" />}
            </div>
          </div>
        ))}
        {err && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{err}</div>}
      </div>

      {/* Composer */}
      <div className="border-t border-white/5 p-3">
        <div className="flex items-end gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 focus-within:border-white/25">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={model ? "Send a message…  (Enter to send, Shift+Enter for newline)" : "Add an account to get models"}
            rows={1}
            className="max-h-40 flex-1 resize-none bg-transparent text-sm text-white outline-none placeholder:text-white/30"
          />
          {busy ? (
            <button onClick={stop} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/15">
              Stop
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!input.trim() || !model}
              className="flex items-center justify-center rounded-lg bg-white px-3 py-1.5 text-black hover:opacity-90 disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
