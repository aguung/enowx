import { useEffect, useMemo, useState } from "react";
import { Loader2, Plug, Check, X, Copy, Terminal, ExternalLink } from "lucide-react";
import { AppShell } from "./shell";
import { copyText } from "../os/clipboard";
import { integrationsApi, accountsApi, type Integration, type IntegrationSnippet, type ProviderModel } from "../lib/api";

// IntegrationsApp connects local CLI coding tools (Claude Code, Codex, Cline, …)
// to this gateway by writing their config to point at it.
export function IntegrationsApp() {
  const [tools, setTools] = useState<Integration[] | null>(null);
  const [info, setInfo] = useState<{ base_url: string; api_key: string } | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [active, setActive] = useState<Integration | null>(null);
  const [err, setErr] = useState("");

  const load = () => integrationsApi.list().then(setTools).catch((e) => setErr(e instanceof Error ? e.message : "failed"));
  useEffect(() => {
    load();
    integrationsApi.info().then(setInfo).catch(() => {});
    accountsApi.allModels().then((r) => setModels((r.models ?? []).map((m: ProviderModel) => m.model_id).filter(Boolean))).catch(() => {});
  }, []);

  const disconnect = async (t: Integration) => {
    try { await integrationsApi.reset(t.key); load(); } catch (e) { setErr(e instanceof Error ? e.message : "failed"); }
  };

  return (
    <AppShell title="Integrations" subtitle="Connect your CLI coding tools to this gateway">
      {info && (
        <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[11px]">
          <div className="mb-2 flex items-center gap-1.5 font-medium text-white/70"><Terminal className="h-3.5 w-3.5" /> Your gateway endpoint</div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            <Field label="Base URL" value={info.base_url + "/v1"} />
            <Field label="API key" value={info.api_key} secret />
          </div>
          <p className="mt-2 text-white/35">Connecting a tool writes these into its config so its requests route through enx.</p>
        </div>
      )}
      {err && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{err}</div>}

      {!tools ? (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-[120px] animate-pulse rounded-2xl border border-white/5 bg-white/[0.02]" />)}
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {tools.map((t) => (
            <ToolCard key={t.key} tool={t} onConnect={() => setActive(t)} onDisconnect={() => disconnect(t)} />
          ))}
        </div>
      )}

      {active && info && (
        <ConnectModal tool={active} info={info} models={models} onClose={() => setActive(null)} onDone={() => { setActive(null); load(); }} />
      )}
    </AppShell>
  );
}

function Field({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [reveal, setReveal] = useState(false);
  const shown = secret && !reveal ? value.slice(0, 8) + "…" + value.slice(-4) : value;
  return (
    <div className="flex items-center gap-2 rounded-lg bg-black/30 px-2.5 py-1.5">
      <span className="shrink-0 text-white/40">{label}</span>
      <code className="flex-1 truncate font-mono text-white/80">{shown}</code>
      {secret && <button onClick={() => setReveal((v) => !v)} className="shrink-0 text-white/40 hover:text-white/80">{reveal ? "hide" : "show"}</button>}
      <button onClick={() => copyText(value)} className="shrink-0 rounded p-0.5 text-white/40 hover:bg-white/10 hover:text-white/80"><Copy className="h-3 w-3" /></button>
    </div>
  );
}

function ToolCard({ tool, onConnect, onDisconnect }: { tool: Integration; onConnect: () => void; onDisconnect: () => void }) {
  return (
    <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
      <div className="flex items-start gap-2.5">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-slate-600 to-slate-800"><Plug className="h-5 w-5 text-white/80" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{tool.name}</p>
          <code className="text-[10px] text-white/35">{tool.binary}</code>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1">
        <Pill on={tool.installed} onText="Installed" offText="Not installed" />
        <Pill on={tool.connected} onText="Connected" offText="Not connected" accent />
      </div>
      {tool.connected && (tool.models?.length ?? 0) > 0 && (
        <p className="mt-1.5 truncate text-[10px] text-white/40">{tool.models.join(", ")}</p>
      )}
      <div className="mt-auto pt-3">
        {tool.connected ? (
          <div className="flex gap-1.5">
            <button onClick={onConnect} className="flex-1 rounded-lg border border-white/10 bg-white/5 py-1.5 text-[11px] text-white/70 hover:bg-white/10">Edit</button>
            <button onClick={onDisconnect} className="flex-1 rounded-lg border border-white/10 bg-white/5 py-1.5 text-[11px] text-white/50 hover:bg-red-500/15 hover:text-red-200">Disconnect</button>
          </div>
        ) : (
          <button onClick={onConnect} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-white py-1.5 text-xs font-medium text-black hover:opacity-90">
            <Plug className="h-3.5 w-3.5" /> Connect
          </button>
        )}
      </div>
    </div>
  );
}

function Pill({ on, onText, offText, accent }: { on: boolean; onText: string; offText: string; accent?: boolean }) {
  const cls = on
    ? accent ? "bg-emerald-500/15 text-emerald-300" : "bg-sky-500/15 text-sky-300"
    : "bg-white/5 text-white/35";
  return <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${cls}`}>{on ? onText : offText}</span>;
}

function ConnectModal({ tool, info, models, onClose, onDone }: {
  tool: Integration; info: { base_url: string; api_key: string }; models: string[];
  onClose: () => void; onDone: () => void;
}) {
  const [tab, setTab] = useState<"apply" | "snippet">("apply");
  const [selected, setSelected] = useState<string[]>(tool.models ?? []);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [snippets, setSnippets] = useState<IntegrationSnippet[] | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? models.filter((m) => m.toLowerCase().includes(q)) : models).slice(0, 40);
  }, [models, query]);

  const toggle = (m: string) => setSelected((s) => tool.multi_model ? (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]) : [m]);

  const body = () => ({ models: selected, model: selected[0], base_url: info.base_url, api_key: info.api_key });

  const apply = async () => {
    if (selected.length === 0) { setErr("Pick at least one model."); return; }
    setBusy(true); setErr("");
    try { await integrationsApi.apply(tool.key, body()); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : "failed"); }
    finally { setBusy(false); }
  };
  const genSnippet = async () => {
    if (selected.length === 0) { setErr("Pick at least one model."); return; }
    setBusy(true); setErr("");
    try { const r = await integrationsApi.snippet(tool.key, body()); setSnippets(r.snippets ?? []); }
    catch (e) { setErr(e instanceof Error ? e.message : "failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-white/10 bg-[#14161c] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-white"><Plug className="h-4 w-4 text-white/60" /> Connect {tool.name}</div>
          <button onClick={onClose} className="rounded-md p-1 text-white/50 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex gap-1 px-4 pt-3">
          <TabBtn active={tab === "apply"} onClick={() => setTab("apply")}>Apply locally</TabBtn>
          <TabBtn active={tab === "snippet"} onClick={() => { setTab("snippet"); }}>Generate config</TabBtn>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <p className="mb-2 text-[11px] text-white/45">
            {tab === "apply"
              ? `Writes ${tool.config_paths.join(", ")} on this machine.`
              : "Copy these into the tool's config on another machine."}
          </p>

          <div className="mb-2 text-[11px] font-medium text-white/50">Model{tool.multi_model ? "s" : ""}</div>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search models…"
            className="mb-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white/80 outline-none focus:border-white/25" />
          <div className="max-h-44 space-y-1 overflow-auto rounded-lg border border-white/10 bg-black/20 p-1.5">
            {filtered.length === 0 ? <div className="p-2 text-[11px] text-white/30">No models.</div> : filtered.map((m) => (
              <button key={m} onClick={() => toggle(m)} className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] ${selected.includes(m) ? "bg-sky-500/15 text-sky-200" : "text-white/60 hover:bg-white/5"}`}>
                <span className={`flex h-3.5 w-3.5 items-center justify-center rounded ${selected.includes(m) ? "bg-sky-400 text-sky-950" : "border border-white/20"}`}>{selected.includes(m) && <Check className="h-2.5 w-2.5" />}</span>
                <code className="flex-1 truncate font-mono">{m}</code>
              </button>
            ))}
          </div>

          {snippets && tab === "snippet" && (
            <div className="mt-3 space-y-2">
              {snippets.map((s) => (
                <div key={s.path} className="rounded-lg border border-white/10 bg-black/25">
                  <div className="flex items-center justify-between px-2.5 py-1.5">
                    <code className="truncate text-[10px] text-white/50">{s.path}</code>
                    <button onClick={() => copyText(s.content)} className="flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70 hover:bg-white/15"><Copy className="h-2.5 w-2.5" /> Copy</button>
                  </div>
                  <pre className="max-h-40 overflow-auto border-t border-white/5 px-2.5 py-1.5 text-[10px] leading-snug text-white/70">{s.content}</pre>
                </div>
              ))}
            </div>
          )}

          {err && <p className="mt-2 text-[11px] text-red-300">{err}</p>}
        </div>

        <div className="border-t border-white/5 p-3">
          {tab === "apply" ? (
            <button onClick={apply} disabled={busy} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-white py-2 text-xs font-semibold text-black hover:opacity-90 disabled:opacity-40">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />} Connect {tool.name}
            </button>
          ) : (
            <button onClick={genSnippet} disabled={busy} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 py-2 text-xs font-medium text-white/80 hover:bg-white/10 disabled:opacity-40">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />} Generate config
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`flex-1 rounded-lg px-3 py-1.5 text-xs ${active ? "bg-white/12 text-white" : "text-white/45 hover:bg-white/5"}`}>{children}</button>;
}
