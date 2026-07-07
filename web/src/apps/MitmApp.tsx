import { useEffect, useState } from "react";
import { Loader2, ShieldAlert, ShieldCheck, Power, Check, Plus, Trash2, RefreshCw } from "lucide-react";
import { AppShell } from "./shell";
import { mitmApi, accountsApi, type MitmStatus, type MitmTool, type ProviderModel } from "../lib/api";

// MitmApp manages the local HTTPS-intercept proxy that reroutes a proprietary
// IDE's hardcoded endpoint (Antigravity, Copilot) through the gateway.
export function MitmApp() {
  const [st, setSt] = useState<MitmStatus | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const load = () => mitmApi.status().then(setSt).catch((e) => setErr(e instanceof Error ? e.message : "failed"));
  useEffect(() => {
    load();
    accountsApi.allModels().then((r) => setModels((r.models ?? []).map((m: ProviderModel) => m.model_id).filter(Boolean))).catch(() => {});
  }, []);

  const run = async (label: string, fn: () => Promise<MitmStatus>) => {
    setBusy(label); setErr("");
    try { setSt(await fn()); } catch (e) { setErr(e instanceof Error ? e.message : "failed"); }
    finally { setBusy(""); }
  };

  return (
    <AppShell title="MITM" subtitle="Route a proprietary IDE through the gateway">
      <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200/90">
        <ShieldAlert className="mt-[1px] h-3.5 w-3.5 shrink-0" />
        <span>Advanced &amp; risky. This installs a local CA into your system trust store, redirects the IDE's domains via your hosts file, and runs a proxy on port 443 (needs admin/root). It may violate the IDE's terms of service and get the underlying account banned. Use at your own risk.</span>
      </div>
      {err && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{err}</div>}

      {!st ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-white/30" /></div>
      ) : (
        <>
          {/* Server + cert controls */}
          <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill on={st.trusted} label={st.trusted ? "CA trusted" : "CA not trusted"} icon={st.trusted ? ShieldCheck : ShieldAlert} />
              <StatusPill on={st.running} label={st.running ? "Proxy running" : "Proxy stopped"} icon={Power} />
              <div className="ml-auto flex gap-1.5">
                {!st.trusted && (
                  <button onClick={() => run("trust", mitmApi.trust)} disabled={!!busy} className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black hover:opacity-90 disabled:opacity-40">
                    {busy === "trust" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} Trust cert
                  </button>
                )}
                {st.running ? (
                  <button onClick={() => run("stop", mitmApi.stop)} disabled={!!busy} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 disabled:opacity-40">
                    {busy === "stop" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />} Stop
                  </button>
                ) : (
                  <button onClick={() => run("start", mitmApi.start)} disabled={!!busy} className="flex items-center gap-1.5 rounded-lg bg-emerald-500/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40">
                    {busy === "start" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />} Start proxy
                  </button>
                )}
                <button onClick={load} title="Refresh" className="rounded-lg border border-white/10 p-1.5 text-white/40 hover:bg-white/5 hover:text-white"><RefreshCw className="h-3.5 w-3.5" /></button>
              </div>
            </div>
            <p className="mt-2 text-[10px] text-white/35">Starting the proxy asks for your admin password once — it launches a privileged helper that installs the CA, redirects the IDE's hosts, and listens on port 443. You don't need to restart enx.</p>
          </div>

          {/* Per-tool cards */}
          <div className="space-y-3">
            {st.tools.map((t) => (
              <ToolBlock key={t.key} tool={t} models={models} busy={busy}
                onEnable={(on) => run("enable:" + t.key, () => mitmApi.enable(t.key, on))}
                onAliases={(a) => run("aliases:" + t.key, () => mitmApi.setAliases(t.key, a))} />
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}

function StatusPill({ on, label, icon: Icon }: { on: boolean; label: string; icon: typeof Power }) {
  return (
    <span className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium ${on ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-white/40"}`}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </span>
  );
}

function ToolBlock({ tool, models, busy, onEnable, onAliases }: {
  tool: MitmTool; models: string[]; busy: string;
  onEnable: (on: boolean) => void; onAliases: (a: Record<string, string>) => void;
}) {
  // Local editable rows: [ideModel, gatewayModel].
  const [rows, setRows] = useState<[string, string][]>(() => Object.entries(tool.aliases ?? {}));
  useEffect(() => { setRows(Object.entries(tool.aliases ?? {})); }, [tool.aliases]);

  const save = () => onAliases(Object.fromEntries(rows.filter(([k, v]) => k.trim() && v.trim())));
  const setRow = (i: number, j: 0 | 1, val: string) => setRows((rs) => rs.map((r, ri) => ri === i ? (j === 0 ? [val, r[1]] : [r[0], val]) : r));

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white" title={tool.hosts.join(", ")}>{tool.name}</span>
        <button onClick={() => onEnable(!tool.dns_enabled)} disabled={busy === "enable:" + tool.key}
          className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-medium disabled:opacity-40 ${tool.dns_enabled ? "bg-emerald-500/80 text-white hover:bg-emerald-500" : "border border-white/10 bg-white/5 text-white/70 hover:bg-white/10"}`}>
          {busy === "enable:" + tool.key ? <Loader2 className="h-3 w-3 animate-spin" /> : tool.dns_enabled ? <Check className="h-3 w-3" /> : null}
          {tool.dns_enabled ? "Intercepting" : "Enable intercept"}
        </button>
      </div>

      <div className="mt-3">
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-white/40">Model mapping <span className="normal-case text-white/30">(IDE model → gateway model)</span></p>
        <div className="space-y-1.5">
          {rows.map(([k, v], i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input value={k} onChange={(e) => setRow(i, 0, e.target.value)} placeholder="IDE model (or *)" list={`m-${tool.key}`}
                className="w-1/2 rounded-md border border-white/10 bg-black/25 px-2 py-1 font-mono text-[11px] text-white/80 outline-none" />
              <span className="text-white/30">→</span>
              <input value={v} onChange={(e) => setRow(i, 1, e.target.value)} placeholder="gateway model" list="gw-models"
                className="flex-1 rounded-md border border-white/10 bg-black/25 px-2 py-1 font-mono text-[11px] text-white/80 outline-none" />
              <button onClick={() => setRows((rs) => rs.filter((_, ri) => ri !== i))} className="rounded p-1 text-white/30 hover:bg-white/10 hover:text-red-300"><Trash2 className="h-3 w-3" /></button>
            </div>
          ))}
          <datalist id={`m-${tool.key}`}>{tool.models.map((m) => <option key={m} value={m} />)}</datalist>
          <datalist id="gw-models">{models.slice(0, 60).map((m) => <option key={m} value={m} />)}</datalist>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <button onClick={() => setRows((rs) => [...rs, ["", ""]])} className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-white/60 hover:bg-white/5"><Plus className="h-3 w-3" /> Add</button>
          <button onClick={save} disabled={busy === "aliases:" + tool.key} className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[11px] text-white/80 hover:bg-white/15 disabled:opacity-40">
            {busy === "aliases:" + tool.key ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Save mapping
          </button>
          <span className="text-[10px] text-white/30">Tip: use <code className="text-white/50">*</code> to map every model.</span>
        </div>
      </div>
      {tool.dns_enabled && <p className="mt-2 text-[10px] text-amber-300/70">Restart {tool.name} so it picks up the new routing.</p>}
    </div>
  );
}

