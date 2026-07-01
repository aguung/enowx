import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Send, Trash2, Loader2, Bot, ChevronDown, ChevronRight, FolderOpen, Shield, Check, X, Terminal, FileEdit, FileText, FilePlus, Globe, Wrench, Folder, CornerLeftUp, Settings2, Plus } from "lucide-react";
import { accountsApi, keysApi, filesApi, type ProviderModel, type DirListing } from "../lib/api";
import { AiMarkdown } from "../components/AiMarkdown";
import { TOOL_SCHEMAS, TOOL_META, GROUPABLE_TOOLS, GROUP_VERB, lineDiff, runTool, needsApproval, type PermLevel, type ToolName, type ToolResult } from "./agent/tools";

const DEFAULT_SYSTEM = `You are a helpful coding assistant running inside the enowx dashboard.
Reply in the same language the user writes in. Be concise and precise.
When agent tools are available, use them to inspect and modify the project in the working directory: read files before editing, prefer edit_file for small changes, and explain what you did.`;

// OpenAI-native chat messages, so the full history (incl. tool_calls + tool
// results) can be sent straight back to /v1/chat/completions each turn.
interface ToolCall {
  id: string;
  name: string;
  args: string; // raw JSON string (may stream in)
}
interface ChatMsg {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[]; // user attachments as data URLs (vision)
  tool_calls?: ToolCall[]; // assistant turn requesting tools
  tool_call_id?: string; // tool result → which call
  name?: string; // tool result → tool name
  // UI-only: rich result of each executed tool call, keyed by call id.
  results?: Record<string, ToolResult>;
}

const PERM_LABELS: Record<PermLevel, string> = { need: "Ask every time", medium: "Confirm writes", bypass: "Auto (bypass)" };
const MAX_STEPS = 12;

const LS = {
  chat: "enowx-aichat-history",
  model: "enowx-aichat-model",
  sys: "enowx-aichat-system",
  cwd: "enowx-aichat-cwd",
  perm: "enowx-aichat-perm",
  agent: "enowx-aichat-agent",
};
const load = <T,>(key: string, fallback: T): T => {
  try { const v = localStorage.getItem(key); return v == null ? fallback : (JSON.parse(v) as T); } catch { return fallback; }
};

// clip caps a string for display/history so a huge file can't bloat the DOM or
// the request body (which crashed the tab on big reads).
const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) + `\n…(+${s.length - max} more chars)` : s);

export function AiChatApp() {
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [model, setModel] = useState(() => load<string>(LS.model, ""));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [msgs, setMsgs] = useState<ChatMsg[]>(() => load<ChatMsg[]>(LS.chat, []));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [apiKey, setApiKey] = useState("");

  const [agentMode, setAgentMode] = useState(() => load<boolean>(LS.agent, false));
  const [cwd, setCwd] = useState(() => load<string>(LS.cwd, ""));
  const [perm, setPerm] = useState<PermLevel>(() => load<PermLevel>(LS.perm, "medium"));
  const [permOpen, setPermOpen] = useState(false);
  const [pending, setPending] = useState<{ call: ToolCall; resolve: (ok: boolean) => void } | null>(null);
  const [sysPrompt, setSysPrompt] = useState(() => load<string>(LS.sys, DEFAULT_SYSTEM));
  const [showSys, setShowSys] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickImages = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).slice(0, 4).forEach((f) => {
      if (!f.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => setAttachments((p) => [...p, String(reader.result)].slice(0, 6));
      reader.readAsDataURL(f);
    });
  };

  useEffect(() => {
    accountsApi.allModels().then((r) => {
      const list = (r.models ?? []).filter((m) => m.type !== "image");
      setModels(list);
      setModel((cur) => cur || (list[0]?.model_id ?? ""));
    }).catch(() => {});
    keysApi.list().then((keys) => {
      const k = keys.find((x) => x.enabled && x.secret);
      if (k) setApiKey(k.secret);
    }).catch(() => {});
  }, []);

  // Persist chat + preferences. Skip while streaming (busy) so we don't serialize
  // the whole history on every animation frame — only save when a turn settles.
  useEffect(() => {
    if (busy) return;
    try { localStorage.setItem(LS.chat, JSON.stringify(msgs.slice(-100))); } catch { /* quota */ }
  }, [msgs, busy]);
  useEffect(() => { if (model) localStorage.setItem(LS.model, JSON.stringify(model)); }, [model]);
  useEffect(() => { localStorage.setItem(LS.sys, JSON.stringify(sysPrompt)); }, [sysPrompt]);
  useEffect(() => { localStorage.setItem(LS.cwd, JSON.stringify(cwd)); }, [cwd]);
  useEffect(() => { localStorage.setItem(LS.perm, JSON.stringify(perm)); }, [perm]);
  useEffect(() => { localStorage.setItem(LS.agent, JSON.stringify(agentMode)); }, [agentMode]);

  useEffect(() => {
    // Instant while streaming (busy) — smooth scroll every frame stacks up.
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: busy ? "auto" : "smooth" });
  }, [msgs, pending, busy]);

  const shownModels = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? models.filter((m) => `${m.name} ${m.model_id}`.toLowerCase().includes(f)) : models;
  }, [models, filter]);

  // wire encodes a UI history into the OpenAI messages array (drops UI-only bits).
  function wire(history: ChatMsg[]) {
    return history.map((m) => {
      if (m.role === "assistant" && m.tool_calls?.length) {
        return {
          role: "assistant",
          content: m.content || null,
          tool_calls: m.tool_calls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.args || "{}" } })),
        };
      }
      if (m.role === "tool") return { role: "tool", tool_call_id: m.tool_call_id, content: m.content };
      if (m.role === "user" && m.images?.length) {
        // Multimodal user content: text + image_url parts (vision models).
        const parts: any[] = [];
        if (m.content) parts.push({ type: "text", text: m.content });
        for (const url of m.images) parts.push({ type: "image_url", image_url: { url } });
        return { role: "user", content: parts };
      }
      return { role: m.role, content: m.content };
    });
  }

  // callModel streams one assistant turn, appending to a fresh assistant msg.
  // Returns the completed assistant message (with any tool_calls).
  async function callModel(history: ChatMsg[], ac: AbortController): Promise<ChatMsg> {
    const messages = wire(history);
    if (sysPrompt.trim()) messages.unshift({ role: "system", content: sysPrompt.trim() });
    const body: Record<string, unknown> = { model, stream: true, messages };
    if (agentMode) body.tools = TOOL_SCHEMAS;

    const res = await fetch("/v1/chat/completions", {
      method: "POST",
      signal: ac.signal,
      headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) throw new Error((await res.text().catch(() => "")) || `request failed (${res.status})`);

    const assistant: ChatMsg = { role: "assistant", content: "" };
    setMsgs((p) => [...p, assistant]);
    const calls: Record<number, ToolCall> = {};

    // Coalesce state updates to one per animation frame — updating on every token
    // triggers thousands of re-renders on long replies and can crash the tab.
    let dirty = false;
    let raf = 0;
    const flush = () => {
      raf = 0;
      if (!dirty) return;
      dirty = false;
      setMsgs((p) => replaceLast(p, { ...assistant, tool_calls: assistant.tool_calls ? [...assistant.tool_calls] : undefined }));
    };
    const schedule = () => {
      dirty = true;
      if (!raf) raf = requestAnimationFrame(flush);
    };

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
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
          let j: any;
          try { j = JSON.parse(data); } catch { continue; }
          const delta = j.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.content) {
            assistant.content += delta.content;
            schedule();
          }
          for (const tc of delta.tool_calls ?? []) {
            const idx = tc.index ?? 0;
            const cur = calls[idx] ?? (calls[idx] = { id: "", name: "", args: "" });
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name = tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
            assistant.tool_calls = Object.keys(calls).sort((a, b) => +a - +b).map((k) => calls[+k]);
            schedule();
          }
        }
      }
    } finally {
      if (raf) cancelAnimationFrame(raf);
    }
    // Final commit so nothing is dropped from the coalescing.
    if (assistant.tool_calls) assistant.tool_calls.forEach((c, i) => { if (!c.id) c.id = `call_${Date.now()}_${i}`; });
    setMsgs((p) => replaceLast(p, { ...assistant, tool_calls: assistant.tool_calls ? [...assistant.tool_calls] : undefined }));
    return assistant;
  }

  async function send() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || busy || !model) return;
    if (agentMode && !cwd.trim()) { setErr("Set a working directory first."); return; }
    setErr("");
    setInput("");
    const imgs = attachments;
    setAttachments([]);

    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    let history: ChatMsg[] = [...msgs, { role: "user", content: text, images: imgs.length ? imgs : undefined }];
    setMsgs(history);

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const assistant = await callModel(history, ac);
        history = [...history, assistant];
        if (!assistant.tool_calls?.length) break; // normal answer → done

        // Execute each tool call, gated by the permission level.
        assistant.results = {};
        for (const call of assistant.tool_calls) {
          const toolName = call.name as ToolName;
          let approved = true;
          if (needsApproval(perm, toolName)) {
            approved = await new Promise<boolean>((resolve) => setPending({ call, resolve }));
            setPending(null);
          }
          let result: ToolResult;
          if (!approved) {
            result = { ok: false, output: "Denied by user." };
          } else {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(call.args || "{}"); } catch { /* bad args */ }
            result = await runTool(cwd, toolName, args);
          }
          // Store a display-capped copy in the UI/persisted state (the full
          // output only ever needs to reach the model, capped just below).
          assistant.results![call.id] = { ...result, output: clip(result.output, 8000) };
          setMsgs((p) => p.map((m) => (m === assistant ? { ...assistant } : m)));
          // Cap the tool output fed back to the model so a big file read can't
          // balloon the request body every subsequent turn.
          history = [...history, { role: "tool", tool_call_id: call.id, name: call.name, content: clip(result.output, 24000) }];
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
      abortRef.current = null;
      setPending(null);
    }
  }

  const stop = () => { abortRef.current?.abort(); pending?.resolve(false); setPending(null); };
  const clear = () => { stop(); setMsgs([]); setErr(""); };
  const current = models.find((m) => m.model_id === model);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[var(--window-bg)]/80">
      {/* Header — minimal: title + clear */}
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
        <Bot className="h-4 w-4 text-white/40" />
        <span className="text-sm font-medium text-white/80">Chat</span>
        <span className="rounded-full border border-indigo-400/30 bg-indigo-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-indigo-300">Beta</span>
        <div className="flex-1" />
        <button onClick={() => setShowSys(true)} title="System prompt" className="rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white"><Settings2 className="h-4 w-4" /></button>
        <button onClick={clear} title="Clear chat" className="rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white"><Trash2 className="h-4 w-4" /></button>
      </div>

      {showBrowser && <FolderBrowser initial={cwd} onPick={(p) => { setCwd(p); setShowBrowser(false); }} onClose={() => setShowBrowser(false)} />}
      {showSys && <SystemPromptModal value={sysPrompt} onSave={(v) => { setSysPrompt(v); setShowSys(false); }} onClose={() => setShowSys(false)} />}

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {msgs.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center text-white/30">
            <Bot className="mb-2 h-8 w-8" />
            <p className="text-sm">Chat with your gateway models.</p>
            <p className="text-[11px]">Enable <span className="text-emerald-300/70">Agent</span> to give it tools (read/write files, run commands).</p>
          </div>
        )}
        <Conversation msgs={msgs} />
        {pending && <ApprovalCard call={pending.call} onDecide={pending.resolve} />}
        {err && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{err}</div>}
      </div>

      {/* Composer — textarea on top, controls toolbar beneath */}
      <div className="p-3">
        <div className="rounded-xl border border-white/10 bg-black/25 focus-within:border-white/25">
          {/* Attachment thumbnails */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 border-b border-white/5 p-2">
              {attachments.map((src, i) => (
                <div key={i} className="group relative h-14 w-14 overflow-hidden rounded-lg border border-white/10">
                  <img src={src} alt="" className="h-full w-full object-cover" />
                  <button onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))} className="absolute right-0.5 top-0.5 rounded bg-black/60 p-0.5 text-white/80 opacity-0 group-hover:opacity-100"><X className="h-3 w-3" /></button>
                </div>
              ))}
            </div>
          )}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            onPaste={(e) => { const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/")); if (imgs.length) { e.preventDefault(); pickImages(e.clipboardData.files); } }}
            placeholder={model ? "What would you like to work on?" : "Add an account to get models"}
            rows={2}
            className="max-h-40 w-full resize-none bg-transparent px-3 pt-2.5 text-sm text-white outline-none placeholder:text-white/30"
          />
          {/* Toolbar */}
          <div className="flex items-center gap-1.5 px-2 pb-2">
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { pickImages(e.target.files); e.target.value = ""; }} />
            <button onClick={() => fileRef.current?.click()} title="Attach image" className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-white/60 hover:bg-white/5 hover:text-white"><Plus className="h-4 w-4" /></button>
            <ModelPicker current={current?.name || model} open={pickerOpen} setOpen={setPickerOpen} filter={filter} setFilter={setFilter} models={shownModels} model={model} setModel={setModel} up />
            <button onClick={() => setAgentMode((v) => !v)} title="Toggle coding-agent tools" className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${agentMode ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" : "border-white/10 text-white/50 hover:text-white/80"}`}>
              <Wrench className="h-3.5 w-3.5" /> Agent
            </button>
            {agentMode && (
              <>
                <button onClick={() => setShowBrowser(true)} title="Working directory" className="flex max-w-[160px] items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1 text-xs text-white/70 hover:bg-white/5">
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-white/40" />
                  <span className="truncate">{cwd ? cwd.split("/").pop() : "Folder"}</span>
                </button>
                <div className="relative">
                  <button onClick={() => setPermOpen((v) => !v)} className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-white/70 hover:bg-white/5">
                    <Shield className="h-3.5 w-3.5 text-white/40" /> {PERM_LABELS[perm]} <ChevronDown className="h-3 w-3 text-white/40" />
                  </button>
                  {permOpen && (
                    <div className="absolute bottom-full left-0 z-30 mb-1 w-44 rounded-xl border border-white/10 bg-[#0e1016] p-1 shadow-2xl">
                      {(["need", "medium", "bypass"] as PermLevel[]).map((l) => (
                        <button key={l} onClick={() => { setPerm(l); setPermOpen(false); }} className={`block w-full rounded px-2 py-1.5 text-left text-xs ${perm === l ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5"}`}>{PERM_LABELS[l]}</button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
            <div className="flex-1" />
            {busy ? (
              <button onClick={stop} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/15">Stop</button>
            ) : (
              <button onClick={send} disabled={(!input.trim() && attachments.length === 0) || !model} className="flex items-center justify-center rounded-lg bg-white px-3 py-1.5 text-black hover:opacity-90 disabled:opacity-40"><Send className="h-4 w-4" /></button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function replaceLast(list: ChatMsg[], msg: ChatMsg): ChatMsg[] {
  const next = [...list];
  next[next.length - 1] = msg;
  return next;
}

function ModelPicker({ current, open, setOpen, filter, setFilter, models, model, setModel, up }: {
  current: string; open: boolean; setOpen: (v: boolean) => void; filter: string; setFilter: (v: string) => void;
  models: ProviderModel[]; model: string; setModel: (v: string) => void; up?: boolean;
}) {
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-xs text-white hover:border-white/25">
        <Bot className="h-3.5 w-3.5 text-white/50" />
        <span className="max-w-[180px] truncate">{current || "Select model"}</span>
        <ChevronDown className="h-3.5 w-3.5 text-white/40" />
      </button>
      {open && (
        <div className={`absolute left-0 z-20 max-h-72 w-72 overflow-hidden rounded-xl border border-white/10 bg-[#0e1016] shadow-2xl ${up ? "bottom-full mb-1" : "top-full mt-1"}`}>
          <input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter models…" className="w-full border-b border-white/5 bg-transparent px-3 py-2 text-xs text-white outline-none placeholder:text-white/30" />
          <div className="max-h-60 overflow-y-auto p-1">
            {models.length === 0 && <div className="px-2 py-3 text-center text-[11px] text-white/40">No models. Add an account first.</div>}
            {models.map((m) => (
              <button key={m.model_id} onClick={() => { setModel(m.model_id); setOpen(false); setFilter(""); }} className={`flex w-full flex-col items-start rounded-lg px-2.5 py-1.5 text-left hover:bg-white/5 ${m.model_id === model ? "bg-white/10" : ""}`}>
                <span className="truncate text-xs text-white">{m.name}</span>
                <span className="truncate font-mono text-[10px] text-white/35">{m.model_id}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// A render item is a user bubble, an assistant text block, a standalone tool
// call, or a group of consecutive groupable tool calls — the last two are built
// across the WHOLE conversation so grouping spans agentic steps (not just one
// message), avoiding a spam of "Read N files" blocks.
type RenderItem =
  | { kind: "user"; content: string; images?: string[]; key: string }
  | { kind: "text"; content: string; key: string }
  | { kind: "spinner"; key: string }
  | { kind: "tool"; call: ToolCall; result?: ToolResult; key: string }
  | { kind: "group"; calls: ToolCall[]; results: Record<string, ToolResult>; key: string };

function buildItems(msgs: ChatMsg[]): RenderItem[] {
  const items: RenderItem[] = [];
  let run: { call: ToolCall; result?: ToolResult }[] = [];
  const flushRun = () => {
    if (run.length >= 2) {
      const results: Record<string, ToolResult> = {};
      run.forEach((r) => { if (r.result) results[r.call.id] = r.result; });
      items.push({ kind: "group", calls: run.map((r) => r.call), results, key: `g_${run[0].call.id}` });
    } else {
      run.forEach((r) => items.push({ kind: "tool", call: r.call, result: r.result, key: `t_${r.call.id}` }));
    }
    run = [];
  };
  msgs.forEach((m, i) => {
    if (m.role === "tool") return;
    if (m.role === "user") { flushRun(); items.push({ kind: "user", content: m.content, images: m.images, key: `u_${i}` }); return; }
    // assistant
    if (m.content) { flushRun(); items.push({ kind: "text", content: m.content, key: `a_${i}` }); }
    else if (!m.tool_calls?.length) { flushRun(); items.push({ kind: "spinner", key: `s_${i}` }); }
    for (const c of m.tool_calls ?? []) {
      const result = m.results?.[c.id];
      if (GROUPABLE_TOOLS.has(c.name as ToolName)) run.push({ call: c, result });
      else { flushRun(); items.push({ kind: "tool", call: c, result, key: `t_${c.id}` }); }
    }
  });
  flushRun();
  return items;
}

// TextBlock is memoized so completed assistant text isn't re-parsed as Markdown
// on every streaming frame — only the block whose content actually changed
// re-renders. This is the main guard against the "Aw, Snap" crash on long chats.
const TextBlock = memo(function TextBlock({ content }: { content: string }) {
  return <div className="min-w-0"><AiMarkdown text={content} /></div>;
});

function Conversation({ msgs }: { msgs: ChatMsg[] }) {
  const items = useMemo(() => buildItems(msgs), [msgs]);
  return (
    <>
      {items.map((it) => {
        switch (it.kind) {
          case "user":
            return (
              <div key={it.key} className="flex justify-end">
                <div className="flex max-w-[85%] flex-col items-end gap-1.5">
                  {it.images && it.images.length > 0 && (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {it.images.map((src, k) => <img key={k} src={src} alt="" className="h-24 w-24 rounded-lg border border-white/10 object-cover" />)}
                    </div>
                  )}
                  {it.content && <div className="whitespace-pre-wrap break-words rounded-2xl bg-indigo-500/90 px-3.5 py-2 text-sm text-white">{it.content}</div>}
                </div>
              </div>
            );
          case "text":
            return <TextBlock key={it.key} content={it.content} />;
          case "spinner":
            return <Loader2 key={it.key} className="h-4 w-4 animate-spin text-white/40" />;
          case "tool":
            return <ToolCard key={it.key} call={it.call} result={it.result} />;
          case "group":
            return <ToolGroup key={it.key} calls={it.calls} results={it.results} />;
        }
      })}
    </>
  );
}

const TOOL_ICONS: Record<string, typeof Terminal> = {
  read_file: FileText, list_dir: Folder, write_file: FilePlus, edit_file: FileEdit, run_command: Terminal, http_request: Globe,
};

// ToolGroup collapses a run of groupable tool calls into one dropdown:
// collapsed shows a summary ("Read 5 files"); expanded shows each row.
const ToolGroup = memo(function ToolGroup({ calls, results }: { calls: ToolCall[]; results: Record<string, ToolResult> }) {
  const [open, setOpen] = useState(false);
  const names = [...new Set(calls.map((c) => c.name))];
  const n = calls.length;
  const label = names.length === 1
    ? (() => { const [verb, noun] = GROUP_VERB[names[0]] ?? ["Ran", "action"]; return `${verb} ${n} ${noun}${n === 1 ? "" : "s"}`; })()
    : `${n} actions`;
  const running = calls.some((c) => !results[c.id]);
  const anyErr = calls.some((c) => results[c.id] && !results[c.id].ok);
  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.02] text-xs">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-white/60 hover:bg-white/[0.04]">
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <Wrench className="h-3.5 w-3.5 shrink-0 text-white/40" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {running ? <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" /> : anyErr ? <span className="text-[10px] font-semibold text-red-400">error</span> : <Check className="h-3.5 w-3.5 text-emerald-400/70" />}
      </button>
      {open && (
        <div className="border-t border-white/10 bg-black/20 py-0.5">
          {calls.map((c) => <GroupRow key={c.id} call={c} result={results[c.id]} />)}
        </div>
      )}
    </div>
  );
});

// GroupRow is one line inside an expanded ToolGroup: status + tool + target.
function GroupRow({ call, result }: { call: ToolCall; result?: ToolResult }) {
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(call.args || "{}"); } catch { /* partial */ }
  const target = String(args.path ?? args.url ?? args.command ?? "");
  const Icon = TOOL_ICONS[call.name] ?? Wrench;
  return (
    <div className="flex items-center gap-2 px-2.5 py-1 text-[11px]">
      {!result ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-sky-400" /> : result.ok ? <Check className="h-3 w-3 shrink-0 text-emerald-400/70" /> : <X className="h-3 w-3 shrink-0 text-red-400" />}
      <Icon className="h-3 w-3 shrink-0 text-white/40" />
      <span className="min-w-0 flex-1 truncate font-mono text-white/60" title={target}>{target || call.name}</span>
    </div>
  );
}

// ToolCard is a compact, robloxkit-style tool row: one line with an
// icon/chevron + filename (parent path beneath) + a right-side +N/-N (for
// edits) or status; expands to an LCS line diff or the raw output.
const ToolCard = memo(function ToolCard({ call, result }: { call: ToolCall; result?: ToolResult }) {
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(call.args || "{}"); } catch { /* streaming/partial */ }

  const running = !result;
  const isEdit = call.name === "write_file" || call.name === "edit_file";
  const Icon = TOOL_ICONS[call.name] ?? Wrench;

  // Compute the diff for write/edit from the result meta (old/new).
  const diffMeta = result?.meta?.diff as { old: string; new: string } | undefined;
  const diff = useMemo(() => {
    if (call.name === "write_file" && diffMeta) return lineDiff(diffMeta.old, diffMeta.new);
    if (call.name === "edit_file") return lineDiff(String(args.old ?? ""), String(args.new ?? ""));
    return null;
  }, [call.name, diffMeta, args.old, args.new]);

  // Label: filename + parent path (for file tools); else the target arg.
  const path = String(args.path ?? "");
  const fileName = path ? path.split("/").pop() : (args.command ? String(args.command) : args.url ? String(args.url) : call.name);
  const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

  const hasDiff = isEdit && diff && diff.rows.length > 0;
  const hasOutput = !isEdit && result;
  const canExpand = !!(hasDiff || hasOutput);
  const open = userToggled !== null ? userToggled : false;

  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.02] text-xs">
      <button onClick={() => canExpand && setUserToggled(!open)} className={`flex w-full items-start gap-2 px-2.5 py-1.5 text-left ${canExpand ? "cursor-pointer hover:bg-white/[0.04]" : "cursor-default"}`}>
        <span className="mt-[1px] shrink-0 text-white/45">
          {canExpand ? (open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : <Icon className="h-3.5 w-3.5" />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={`truncate font-mono ${isEdit ? "text-indigo-300" : "text-white/85"}`}>
            <span className="text-[9px] uppercase tracking-wide text-white/35">{TOOL_META[call.name]?.label ?? call.name}</span>{" "}
            {fileName}
          </span>
          {parent && <span className="truncate font-mono text-[9px] text-white/35">{parent}/</span>}
        </span>
        <span className="mt-[1px] flex shrink-0 items-center gap-1.5 text-[10px] font-semibold">
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
          ) : isEdit && diff ? (
            <>
              {diff.added > 0 && <span className="text-emerald-400">+{diff.added}</span>}
              {diff.removed > 0 && <span className="text-red-400">-{diff.removed}</span>}
              {diff.added === 0 && diff.removed === 0 && <Check className="h-3.5 w-3.5 text-emerald-400/70" />}
            </>
          ) : result?.ok ? (
            <Check className="h-3.5 w-3.5 text-emerald-400/70" />
          ) : (
            <span className="text-red-400">error</span>
          )}
        </span>
      </button>
      {open && canExpand && (
        <div className="border-t border-white/10 bg-black/25">
          {hasDiff ? (
            <div className="max-h-64 overflow-auto py-1 font-mono text-[11px] leading-[1.45]">
              {diff!.rows.slice(0, 400).map((r, ri) => (
                <div key={ri} className={`flex gap-2 px-2.5 ${r.type === "add" ? "bg-emerald-500/10 text-emerald-200/90" : r.type === "del" ? "bg-red-500/10 text-red-300/80" : "text-white/60"}`}>
                  <span className={`select-none ${r.type === "add" ? "text-emerald-400" : r.type === "del" ? "text-red-400" : "text-transparent"}`}>{r.type === "add" ? "+" : r.type === "del" ? "-" : " "}</span>
                  <span className="whitespace-pre">{r.text || " "}</span>
                </div>
              ))}
            </div>
          ) : (
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words px-2.5 py-1.5 font-mono text-[10px] text-white/70">{clip(result?.output ?? "", 8000)}</pre>
          )}
        </div>
      )}
    </div>
  );
});

// FolderBrowser navigates the local filesystem (dirs only) and picks a folder as
// the agent's working directory. Uses the read-only Files handler.
function FolderBrowser({ initial, onPick, onClose }: { initial: string; onPick: (path: string) => void; onClose: () => void }) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [err, setErr] = useState("");
  const load = (path?: string) => filesApi.list(path).then(setListing).catch((e) => setErr(e instanceof Error ? e.message : "cannot open"));
  useEffect(() => { load(initial || undefined); }, []);
  const dirs = (listing?.entries ?? []).filter((e) => e.is_dir);
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[80%] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0e1016] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <Folder className="h-4 w-4 text-white/50" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-white/70">{listing?.path ?? "…"}</span>
          <button onClick={onClose} className="rounded-lg p-1 text-white/50 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {err && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{err}</div>}
          {listing && listing.parent && listing.parent !== listing.path && (
            <button onClick={() => { setErr(""); load(listing.parent); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-white/60 hover:bg-white/5">
              <CornerLeftUp className="h-3.5 w-3.5" /> ..
            </button>
          )}
          {dirs.map((d) => (
            <button key={d.name} onClick={() => { setErr(""); load(`${listing!.path.replace(/\/+$/, "")}/${d.name}`); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-white/80 hover:bg-white/5">
              <Folder className="h-3.5 w-3.5 text-white/40" /> {d.name}
            </button>
          ))}
          {dirs.length === 0 && !err && <div className="px-3 py-4 text-center text-[11px] text-white/30">No subfolders here.</div>}
        </div>
        <div className="flex items-center justify-between border-t border-white/10 px-4 py-3">
          <span className="truncate font-mono text-[10px] text-white/35">Select this folder as the project root</span>
          <button onClick={() => listing && onPick(listing.path)} className="rounded-lg bg-white px-3.5 py-1.5 text-xs font-medium text-black hover:opacity-90">Use this folder</button>
        </div>
      </div>
    </div>
  );
}

function SystemPromptModal({ value, onSave, onClose }: { value: string; onSave: (v: string) => void; onClose: () => void }) {
  const [text, setText] = useState(value);
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[80%] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0e1016] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <Settings2 className="h-4 w-4 text-white/50" />
          <span className="flex-1 text-sm font-semibold text-white">System prompt</span>
          <button onClick={onClose} className="rounded-lg p-1 text-white/50 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} className="h-56 w-full resize-none rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-white outline-none focus:border-white/25" />
        </div>
        <div className="flex items-center justify-between border-t border-white/10 px-4 py-3">
          <button onClick={() => setText(DEFAULT_SYSTEM)} className="text-xs text-white/50 hover:text-white">Reset to default</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:bg-white/5">Cancel</button>
            <button onClick={() => onSave(text)} className="rounded-lg bg-white px-3.5 py-1.5 text-xs font-medium text-black hover:opacity-90">Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApprovalCard({ call, onDecide }: { call: ToolCall; onDecide: (ok: boolean) => void }) {
  return (
    <div className="ml-9 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
      <div className="mb-2 flex items-center gap-2 text-amber-200">
        <Shield className="h-4 w-4" /> Allow <span className="font-mono">{call.name}</span>?
      </div>
      <pre className="mb-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-black/30 p-2 font-mono text-[10px] text-white/70">{call.args}</pre>
      <div className="flex gap-2">
        <button onClick={() => onDecide(true)} className="flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-[11px] font-medium text-black hover:opacity-90"><Check className="h-3.5 w-3.5" /> Approve</button>
        <button onClick={() => onDecide(false)} className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-[11px] text-white hover:bg-white/15"><X className="h-3.5 w-3.5" /> Deny</button>
      </div>
    </div>
  );
}
