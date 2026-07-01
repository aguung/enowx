import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Plus, Trash2, Loader2, Save, FolderPlus, ChevronRight, ChevronDown, History, Globe, X, Pencil } from "lucide-react";
import {
  apitestApi,
  type ApiCollection,
  type ApiSavedRequest,
  type ApiEnvironment,
  type ApiHistoryItem,
  type KV,
} from "../lib/api";
import { useDialog } from "../os/dialog";
import { useContextMenu } from "../os/contextmenu";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const METHODS: Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
type BodyType = "none" | "json" | "form" | "multipart" | "raw" | "graphql";
type AuthType = "none" | "bearer" | "basic" | "apikey";
interface Auth {
  type: AuthType;
  token?: string;
  username?: string;
  password?: string;
  key?: string;
  value?: string;
  in?: "header" | "query";
}

// The live editor state for the current request.
interface Draft {
  id: number; // 0 = unsaved
  collection_id: number;
  name: string;
  method: Method;
  baseUrl: string;
  url: string;
  headers: KV[];
  query: KV[];
  body: string;
  bodyType: BodyType;
  auth: Auth;
}

const blankDraft = (): Draft => ({
  id: 0,
  collection_id: 0,
  name: "Untitled",
  method: "GET",
  baseUrl: "",
  url: "",
  headers: [{ key: "", value: "", on: true }],
  query: [{ key: "", value: "", on: true }],
  body: "",
  bodyType: "none",
  auth: { type: "none" },
});

function parseKV(json: string): KV[] {
  try {
    const a = JSON.parse(json);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}
const withBlank = (rows: KV[]) => [...rows.filter((r) => r.key || r.value), { key: "", value: "", on: true }];

// ApiTestApp is a Postman-style dev tool for testing any HTTP API. Collections,
// environments and history persist in the local gateway (SQLite).
export function ApiTestApp() {
  const [collections, setCollections] = useState<ApiCollection[]>([]);
  const [saved, setSaved] = useState<ApiSavedRequest[]>([]);
  const [envs, setEnvs] = useState<ApiEnvironment[]>([]);
  const [history, setHistory] = useState<ApiHistoryItem[]>([]);

  const dialog = useDialog();
  const ctx = useContextMenu();
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [reqTab, setReqTab] = useState<"params" | "auth" | "headers" | "body">("body");
  const [sidebarTab, setSidebarTab] = useState<"collections" | "history">("collections");
  const [openCols, setOpenCols] = useState<Record<number, boolean>>({});

  const [busy, setBusy] = useState(false);
  const [resStatus, setResStatus] = useState<number | null>(null);
  const [resTime, setResTime] = useState<number | null>(null);
  const [resBody, setResBody] = useState("");
  const [resCType, setResCType] = useState("");
  const [err, setErr] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const reload = () =>
    apitestApi.all().then((d) => {
      setCollections(d.collections ?? []);
      setSaved(d.requests ?? []);
      setEnvs(d.environments ?? []);
      setHistory(d.history ?? []);
      setOpenCols((prev) => {
        const next = { ...prev };
        for (const c of d.collections ?? []) if (next[c.id] === undefined) next[c.id] = true;
        return next;
      });
    });

  useEffect(() => {
    reload().catch(() => {});
  }, []);

  const activeEnv = envs.find((e) => e.active) || null;
  const envVars = useMemo(() => {
    const map: Record<string, string> = {};
    if (activeEnv) for (const v of parseKV(activeEnv.vars)) if (v.key) map[v.key] = v.value;
    return map;
  }, [activeEnv]);
  const interp = (s: string) => s.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, k) => envVars[k] ?? `{{${k}}}`);

  const bodyAllowed = draft.method !== "GET" && draft.method !== "DELETE";

  function loadSaved(r: ApiSavedRequest) {
    setDraft({
      id: r.id,
      collection_id: r.collection_id,
      name: r.name,
      method: (r.method as Method) || "GET",
      baseUrl: r.base_url || "",
      url: r.url,
      headers: withBlank(parseKV(r.headers)),
      query: withBlank(parseKV(r.query)),
      body: r.body,
      bodyType: (r.body_type as BodyType) || "none",
      auth: (() => { try { return JSON.parse(r.auth || "{}"); } catch { return { type: "none" }; } })(),
    });
    setReqTab(r.body_type && r.body_type !== "none" ? "body" : "params");
  }

  // Create a fresh blank request in a collection and load it for editing.
  async function newRequest(cid: number) {
    const { id } = await apitestApi.saveRequest({ collection_id: cid, name: "New request", method: "GET", url: "", body_type: "none" });
    await reload();
    setDraft({ ...blankDraft(), id, collection_id: cid, name: "New request" });
    setOpenCols((p) => ({ ...p, [cid]: true }));
  }

  async function renameCollection(c: ApiCollection) {
    const name = await dialog.prompt({ title: "Rename collection", defaultValue: c.name });
    if (name && name.trim() && name.trim() !== c.name) {
      await apitestApi.renameCollection(c.id, name.trim());
      reload();
    }
  }

  async function duplicateRequest(r: ApiSavedRequest) {
    await apitestApi.saveRequest({
      collection_id: r.collection_id, name: `${r.name} copy`, method: r.method, url: r.url,
      headers: r.headers, query: r.query, body: r.body, body_type: r.body_type, auth: r.auth,
    });
    reload();
  }

  // Right-click menus.
  const collectionMenu = (c: ApiCollection) => [
    { label: "New request", onClick: () => newRequest(c.id) },
    { label: "Rename", onClick: () => renameCollection(c) },
    { separator: true },
    { label: "Delete collection", danger: true, onClick: () => apitestApi.deleteCollection(c.id).then(reload) },
  ];
  const requestMenu = (r: ApiSavedRequest) => [
    { label: "Open", onClick: () => loadSaved(r) },
    { label: "Duplicate", onClick: () => duplicateRequest(r) },
    { separator: true },
    { label: "Delete", danger: true, onClick: () => apitestApi.deleteRequest(r.id).then(reload) },
  ];

  // Build the final URL: base URL + path (unless the path is already absolute),
  // then query params, then env interpolation.
  function buildURL(): string {
    const path = interp(draft.url.trim());
    const base = interp(draft.baseUrl.trim());
    let u = path;
    if (base && !/^https?:\/\//i.test(path)) {
      u = base.replace(/\/+$/, "") + (path && !path.startsWith("/") ? "/" : "") + path;
    }
    const qs = draft.query.filter((q) => q.on && q.key.trim()).map((q) => `${encodeURIComponent(interp(q.key))}=${encodeURIComponent(interp(q.value))}`);
    if (qs.length) u += (u.includes("?") ? "&" : "?") + qs.join("&");
    return u;
  }

  function buildHeaders(): Record<string, string> {
    const h: Record<string, string> = {};
    for (const row of draft.headers) if (row.on && row.key.trim()) h[interp(row.key.trim())] = interp(row.value);
    // Auth builder.
    const a = draft.auth;
    if (a.type === "bearer" && a.token) h["Authorization"] = `Bearer ${interp(a.token)}`;
    else if (a.type === "basic") h["Authorization"] = `Basic ${btoa(`${interp(a.username || "")}:${interp(a.password || "")}`)}`;
    else if (a.type === "apikey" && a.key && (a.in ?? "header") === "header") h[interp(a.key)] = interp(a.value || "");
    // Body content-type.
    if (bodyAllowed && draft.body.trim()) {
      if (draft.bodyType === "json" || draft.bodyType === "graphql") h["Content-Type"] ||= "application/json";
      else if (draft.bodyType === "form") h["Content-Type"] ||= "application/x-www-form-urlencoded";
    }
    return h;
  }

  function buildBody(): BodyInit | undefined {
    if (!bodyAllowed) return undefined;
    if (draft.bodyType === "graphql") {
      try {
        return JSON.stringify({ query: draft.body });
      } catch {
        return draft.body;
      }
    }
    return draft.body.trim() ? interp(draft.body) : undefined;
  }

  async function send() {
    if (busy) return;
    setErr("");
    setResStatus(null);
    setResBody("");
    setResCType("");
    setResTime(null);
    setBusy(true);

    let url = buildURL();
    // apikey-in-query auth.
    if (draft.auth.type === "apikey" && draft.auth.key && draft.auth.in === "query") {
      url += (url.includes("?") ? "&" : "?") + `${encodeURIComponent(interp(draft.auth.key))}=${encodeURIComponent(interp(draft.auth.value || ""))}`;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    const start = performance.now();
    let status = 0;
    try {
      const res = await fetch(url, { method: draft.method, signal: ac.signal, headers: buildHeaders(), body: buildBody() });
      status = res.status;
      setResStatus(res.status);
      const ctype = res.headers.get("content-type") ?? "";
      setResCType(ctype);
      if (ctype.includes("text/event-stream") && res.body) {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          setResBody((prev) => prev + dec.decode(value, { stream: true }));
        }
      } else {
        const text = await res.text();
        try {
          setResBody(JSON.stringify(JSON.parse(text), null, 2));
        } catch {
          setResBody(text);
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr(e instanceof Error ? e.message : "request failed");
    } finally {
      const ms = Math.round(performance.now() - start);
      setResTime(ms);
      setBusy(false);
      abortRef.current = null;
      apitestApi.addHistory({ method: draft.method, url, status, duration_ms: ms }).then(() => reload()).catch(() => {});
    }
  }

  async function saveRequest(toCollection?: number) {
    const cid = toCollection ?? draft.collection_id ?? collections[0]?.id ?? 0;
    if (!cid) {
      const { id } = await apitestApi.addCollection("My requests");
      await doSave(id);
      return;
    }
    await doSave(cid);
  }
  async function doSave(cid: number) {
    const payload: Partial<ApiSavedRequest> = {
      id: draft.id || undefined,
      collection_id: cid,
      name: draft.name || "Untitled",
      method: draft.method,
      base_url: draft.baseUrl,
      url: draft.url,
      headers: JSON.stringify(draft.headers.filter((h) => h.key)),
      query: JSON.stringify(draft.query.filter((q) => q.key)),
      body: draft.body,
      body_type: draft.bodyType,
      auth: JSON.stringify(draft.auth),
    };
    const { id } = await apitestApi.saveRequest(payload);
    setDraft((d) => ({ ...d, id, collection_id: cid }));
    reload();
  }

  const statusColor = resStatus == null ? "" : resStatus < 300 ? "text-emerald-400" : resStatus < 400 ? "text-amber-400" : "text-red-400";

  return (
    <div className="flex h-full overflow-hidden rounded-2xl border border-white/10 bg-[var(--window-bg)]/80">
      {/* Sidebar */}
      <div className="flex w-56 shrink-0 flex-col border-r border-white/5">
        <div className="flex items-center gap-1 border-b border-white/5 px-2 py-1.5 text-[11px]">
          <button onClick={() => setSidebarTab("collections")} className={`flex-1 rounded px-2 py-1 ${sidebarTab === "collections" ? "bg-white/10 text-white" : "text-white/45"}`}>Collections</button>
          <button onClick={() => setSidebarTab("history")} className={`flex-1 rounded px-2 py-1 ${sidebarTab === "history" ? "bg-white/10 text-white" : "text-white/45"}`}>History</button>
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto p-1.5"
          onContextMenu={(e) => {
            if (sidebarTab === "collections") ctx.show(e, [{ label: "New collection", onClick: () => apitestApi.addCollection("New collection").then(reload) }]);
          }}
        >
          {sidebarTab === "collections" ? (
            <>
              {collections.map((c) => (
                <div key={c.id}>
                  <div onContextMenu={(e) => ctx.show(e, collectionMenu(c))} className="group flex items-center gap-1 rounded px-1 py-1 hover:bg-white/5">
                    <button onClick={() => setOpenCols((p) => ({ ...p, [c.id]: !p[c.id] }))} className="text-white/40">
                      {openCols[c.id] ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </button>
                    <button onClick={() => setOpenCols((p) => ({ ...p, [c.id]: !p[c.id] }))} className="flex-1 truncate text-left text-xs text-white/80">{c.name}</button>
                    <button onClick={() => newRequest(c.id)} title="New request" className="text-white/30 opacity-0 hover:text-white group-hover:opacity-100"><Plus className="h-3.5 w-3.5" /></button>
                    <button onClick={() => renameCollection(c)} title="Rename collection" className="text-white/30 opacity-0 hover:text-white group-hover:opacity-100"><Pencil className="h-3 w-3" /></button>
                    <button onClick={() => apitestApi.deleteCollection(c.id).then(reload)} title="Delete collection" className="text-white/30 opacity-0 hover:text-red-400 group-hover:opacity-100"><Trash2 className="h-3 w-3" /></button>
                  </div>
                  {openCols[c.id] &&
                    saved.filter((r) => r.collection_id === c.id).map((r) => (
                      <div key={r.id} onContextMenu={(e) => ctx.show(e, requestMenu(r))} className="group ml-4 flex items-center gap-1 rounded px-1.5 py-1 hover:bg-white/5">
                        <button onClick={() => loadSaved(r)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                          <span className={`shrink-0 font-mono text-[9px] ${methodColor(r.method)}`}>{r.method}</span>
                          <span className="truncate text-[11px] text-white/70">{r.name}</span>
                        </button>
                        <button onClick={() => apitestApi.deleteRequest(r.id).then(reload)} className="text-white/30 opacity-0 hover:text-red-400 group-hover:opacity-100"><X className="h-3 w-3" /></button>
                      </div>
                    ))}
                </div>
              ))}
              <button onClick={() => apitestApi.addCollection("New collection").then(reload)} className="mt-1 flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-[11px] text-white/45 hover:bg-white/5 hover:text-white">
                <FolderPlus className="h-3.5 w-3.5" /> New collection
              </button>
            </>
          ) : (
            <>
              {history.length === 0 && <div className="px-2 py-3 text-center text-[11px] text-white/30">No history yet.</div>}
              {history.map((h) => (
                <button key={h.id} onClick={() => setDraft((d) => ({ ...d, method: (h.method as Method) || "GET", url: h.url }))} className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-white/5">
                  <span className={`shrink-0 font-mono text-[9px] ${methodColor(h.method)}`}>{h.method}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-white/60">{h.url}</span>
                  <span className={`shrink-0 font-mono text-[9px] ${h.status < 300 ? "text-emerald-400/70" : "text-red-400/70"}`}>{h.status || "—"}</span>
                </button>
              ))}
              {history.length > 0 && (
                <button onClick={() => apitestApi.clearHistory().then(reload)} className="mt-1 flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-[11px] text-white/40 hover:bg-white/5 hover:text-red-400">
                  <Trash2 className="h-3.5 w-3.5" /> Clear history
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        {/* Top row: name + env + save */}
        <div className="flex items-center gap-2">
          <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} className="w-40 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-white outline-none focus:border-white/25" />
          <div className="flex-1" />
          <EnvSwitcher envs={envs} onChange={reload} />
          <button onClick={() => saveRequest()} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/5 hover:text-white"><Save className="h-3.5 w-3.5" /> Save</button>
        </div>

        {/* Base URL */}
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-right text-[10px] uppercase tracking-wide text-white/35">Base URL</span>
          <input value={draft.baseUrl} onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))} placeholder="https://api.example.com   (optional; prepended to a relative path)" className="flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 font-mono text-[11px] text-white/80 outline-none focus:border-white/25" />
        </div>

        {/* Method + URL + Send */}
        <div className="flex items-center gap-2">
          <select value={draft.method} onChange={(e) => setDraft((d) => ({ ...d, method: e.target.value as Method }))} className="rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-xs font-semibold text-white outline-none">
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <input value={draft.url} onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))} placeholder={draft.baseUrl ? "/path/…  (joined to base URL)" : "https://api.example.com/path  or  /path"} className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white outline-none focus:border-white/25" />
          {busy ? (
            <button onClick={() => abortRef.current?.abort()} className="rounded-lg bg-white/10 px-3 py-2 text-xs text-white hover:bg-white/15">Stop</button>
          ) : (
            <button onClick={send} className="flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-xs font-medium text-black hover:opacity-90"><Send className="h-3.5 w-3.5" /> Send</button>
          )}
        </div>
        {draft.baseUrl.trim() && draft.url.trim() && !/^https?:\/\//i.test(draft.url) && (
          <div className="truncate px-1 font-mono text-[10px] text-white/30">→ {buildURL()}</div>
        )}

        {/* Request tabs */}
        <div className="flex gap-1 border-b border-white/5 text-xs">
          {(["params", "auth", "headers", "body"] as const).map((t) => (
            <button key={t} onClick={() => setReqTab(t)} className={`px-2.5 py-1.5 capitalize ${reqTab === t ? "border-b-2 border-white text-white" : "text-white/45 hover:text-white/80"}`}>
              {t}
              {t === "params" && draft.query.filter((q) => q.on && q.key).length > 0 && ` (${draft.query.filter((q) => q.on && q.key).length})`}
              {t === "headers" && draft.headers.filter((x) => x.on && x.key).length > 0 && ` (${draft.headers.filter((x) => x.on && x.key).length})`}
            </button>
          ))}
        </div>

        {/* Request editor */}
        <div className="min-h-[120px]">
          {reqTab === "params" && <KVEditor rows={draft.query} onChange={(query) => setDraft((d) => ({ ...d, query }))} placeholder="param" />}
          {reqTab === "headers" && <KVEditor rows={draft.headers} onChange={(headers) => setDraft((d) => ({ ...d, headers }))} placeholder="Header" />}
          {reqTab === "auth" && <AuthEditor auth={draft.auth} onChange={(auth) => setDraft((d) => ({ ...d, auth }))} />}
          {reqTab === "body" && <BodyEditor allowed={bodyAllowed} type={draft.bodyType} body={draft.body} onType={(bodyType) => setDraft((d) => ({ ...d, bodyType }))} onBody={(body) => setDraft((d) => ({ ...d, body }))} />}
        </div>

        {/* Response */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-white/10 bg-black/20">
          <div className="flex items-center gap-3 border-b border-white/5 px-3 py-1.5 text-[11px]">
            <span className="font-medium text-white/50">Response</span>
            {resStatus != null && <span className={`font-mono font-semibold ${statusColor}`}>{resStatus}</span>}
            {resTime != null && <span className="font-mono text-white/40">{resTime} ms</span>}
            {resCType && <span className="truncate font-mono text-white/30">{resCType.split(";")[0]}</span>}
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
    </div>
  );
}

function methodColor(m: string) {
  return m === "GET" ? "text-emerald-400" : m === "POST" ? "text-amber-400" : m === "DELETE" ? "text-red-400" : "text-indigo-400";
}

function KVEditor({ rows, onChange, placeholder }: { rows: KV[]; onChange: (r: KV[]) => void; placeholder: string }) {
  const set = (i: number, patch: Partial<KV>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input type="checkbox" checked={row.on !== false} onChange={(e) => set(i, { on: e.target.checked })} className="accent-white" />
          <input value={row.key} onChange={(e) => set(i, { key: e.target.value })} placeholder={placeholder} className="w-40 rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-[11px] text-white outline-none" />
          <input value={row.value} onChange={(e) => set(i, { value: e.target.value })} placeholder="Value" className="flex-1 rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-[11px] text-white outline-none" />
          <button onClick={() => onChange(rows.filter((_, j) => j !== i))} className="rounded p-1 text-white/40 hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ))}
      <button onClick={() => onChange([...rows, { key: "", value: "", on: true }])} className="flex items-center gap-1 text-[11px] text-white/50 hover:text-white"><Plus className="h-3 w-3" /> Add</button>
    </div>
  );
}

function AuthEditor({ auth, onChange }: { auth: Auth; onChange: (a: Auth) => void }) {
  const types: { k: AuthType; label: string }[] = [
    { k: "none", label: "None" },
    { k: "bearer", label: "Bearer" },
    { k: "basic", label: "Basic" },
    { k: "apikey", label: "API Key" },
  ];
  const inp = "w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-[11px] text-white outline-none focus:border-white/25";
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        {types.map((t) => (
          <button key={t.k} onClick={() => onChange({ ...auth, type: t.k })} className={`rounded-lg border px-2.5 py-1 text-[11px] ${auth.type === t.k ? "border-white/30 bg-white/10 text-white" : "border-white/10 text-white/50 hover:bg-white/5"}`}>{t.label}</button>
        ))}
      </div>
      {auth.type === "bearer" && <input value={auth.token ?? ""} onChange={(e) => onChange({ ...auth, token: e.target.value })} placeholder="Token  (supports {{var}})" className={inp} />}
      {auth.type === "basic" && (
        <div className="grid grid-cols-2 gap-2">
          <input value={auth.username ?? ""} onChange={(e) => onChange({ ...auth, username: e.target.value })} placeholder="Username" className={inp} />
          <input value={auth.password ?? ""} onChange={(e) => onChange({ ...auth, password: e.target.value })} placeholder="Password" className={inp} />
        </div>
      )}
      {auth.type === "apikey" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input value={auth.key ?? ""} onChange={(e) => onChange({ ...auth, key: e.target.value })} placeholder="Key (e.g. X-API-Key)" className={inp} />
            <input value={auth.value ?? ""} onChange={(e) => onChange({ ...auth, value: e.target.value })} placeholder="Value" className={inp} />
          </div>
          <div className="flex gap-1.5 text-[11px]">
            {(["header", "query"] as const).map((w) => (
              <button key={w} onClick={() => onChange({ ...auth, in: w })} className={`rounded px-2 py-1 capitalize ${(auth.in ?? "header") === w ? "bg-white/10 text-white" : "text-white/45 hover:text-white"}`}>Add to {w}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BodyEditor({ allowed, type, body, onType, onBody }: { allowed: boolean; type: BodyType; body: string; onType: (t: BodyType) => void; onBody: (b: string) => void }) {
  if (!allowed) return <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-center text-[11px] text-white/40">This method has no body.</div>;
  const types: BodyType[] = ["none", "json", "form", "multipart", "raw", "graphql"];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {types.map((t) => (
          <button key={t} onClick={() => onType(t)} className={`rounded px-2 py-1 capitalize ${type === t ? "bg-white/10 text-white" : "text-white/45 hover:text-white"}`}>{t}</button>
        ))}
      </div>
      {type === "none" ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-center text-[11px] text-white/40">No body.</div>
      ) : type === "form" ? (
        <FormEditor body={body} onBody={onBody} />
      ) : type === "multipart" ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-[11px] text-white/40">Multipart/file upload — coming from the Params-style rows below.<FormEditor body={body} onBody={onBody} /></div>
      ) : (
        <textarea
          value={body}
          onChange={(e) => onBody(e.target.value)}
          spellCheck={false}
          placeholder={type === "graphql" ? "query { }" : type === "json" ? "{ }  (supports {{var}})" : "raw body"}
          className="h-32 w-full resize-none rounded-lg border border-white/10 bg-black/30 p-2.5 font-mono text-xs text-white outline-none focus:border-white/25"
        />
      )}
    </div>
  );
}

// FormEditor edits key=value pairs stored as a urlencoded string in `body`.
function FormEditor({ body, onBody }: { body: string; onBody: (b: string) => void }) {
  const rows = useMemo<KV[]>(() => {
    const out: KV[] = [];
    for (const p of body.split("&")) {
      if (!p) continue;
      const [k, v = ""] = p.split("=");
      out.push({ key: decodeURIComponent(k), value: decodeURIComponent(v), on: true });
    }
    return out.length ? out : [{ key: "", value: "", on: true }];
  }, [body]);
  const commit = (next: KV[]) => onBody(next.filter((r) => r.key).map((r) => `${encodeURIComponent(r.key)}=${encodeURIComponent(r.value)}`).join("&"));
  return <KVEditor rows={rows} onChange={commit} placeholder="field" />;
}

function EnvSwitcher({ envs, onChange }: { envs: ApiEnvironment[]; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const active = envs.find((e) => e.active);
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/5">
        <Globe className="h-3.5 w-3.5 text-white/40" />
        {active?.name ?? "No environment"}
        <ChevronDown className="h-3 w-3 text-white/40" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-xl border border-white/10 bg-[#0e1016] p-2 shadow-2xl">
          <button onClick={() => { apitestApi.activateEnv(0).then(onChange); setOpen(false); }} className={`w-full rounded px-2 py-1 text-left text-xs ${!active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5"}`}>No environment</button>
          {envs.map((e) => (
            <EnvRow key={e.id} env={e} onChange={onChange} />
          ))}
          <button onClick={() => apitestApi.saveEnv({ name: "New env", vars: "[]" }).then(onChange)} className="mt-1 flex w-full items-center gap-1.5 rounded px-2 py-1 text-[11px] text-white/45 hover:bg-white/5 hover:text-white"><Plus className="h-3 w-3" /> New environment</button>
        </div>
      )}
    </div>
  );
}

function EnvRow({ env, onChange }: { env: ApiEnvironment; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(env.name);
  const [vars, setVars] = useState<KV[]>(() => withBlank(parseKV(env.vars)));
  const save = () => {
    apitestApi.saveEnv({ id: env.id, name, vars: JSON.stringify(vars.filter((v) => v.key)) }).then(() => { setEditing(false); onChange(); });
  };
  if (editing) {
    return (
      <div className="rounded-lg border border-white/10 bg-black/20 p-2">
        <input value={name} onChange={(e) => setName(e.target.value)} className="mb-1 w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-white outline-none" />
        <KVEditor rows={vars} onChange={setVars} placeholder="var" />
        <div className="mt-1 flex gap-1">
          <button onClick={save} className="rounded bg-white px-2 py-1 text-[11px] font-medium text-black">Save</button>
          <button onClick={() => setEditing(false)} className="rounded px-2 py-1 text-[11px] text-white/50">Cancel</button>
          <div className="flex-1" />
          <button onClick={() => apitestApi.deleteEnv(env.id).then(onChange)} className="rounded px-2 py-1 text-[11px] text-red-400/70 hover:text-red-400">Delete</button>
        </div>
      </div>
    );
  }
  return (
    <div className="group flex items-center gap-1">
      <button onClick={() => apitestApi.activateEnv(env.id).then(onChange)} className={`flex-1 rounded px-2 py-1 text-left text-xs ${env.active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5"}`}>{env.name}</button>
      <button onClick={() => setEditing(true)} className="text-white/30 opacity-0 hover:text-white group-hover:opacity-100"><History className="h-3 w-3 rotate-90" /></button>
    </div>
  );
}
