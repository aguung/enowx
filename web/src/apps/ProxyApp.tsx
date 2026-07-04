import { useEffect, useState } from "react";
import { Plus, Trash2, Wifi, Loader2, Power, RefreshCw, Globe2 } from "lucide-react";
import { AppShell } from "./shell";
import { proxyApi, providersApi, type ProxyItem, type ProxySettings, type Provider } from "../lib/api";

// ProxyApp manages the outbound proxy pool: add proxies in any format, test
// them, toggle/delete, and configure which providers route through the pool.
export function ProxyApp() {
  const [proxies, setProxies] = useState<ProxyItem[] | null>(null);
  const [settings, setSettings] = useState<ProxySettings | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = () => {
    proxyApi.list().then((r) => setProxies(r.proxies)).catch(() => setProxies([]));
    proxyApi.getSettings().then(setSettings).catch(() => {});
  };
  useEffect(() => {
    load();
    providersApi.list().then(setProviders).catch(() => {});
  }, []);

  const add = async () => {
    if (!draft.trim() || adding) return;
    setAdding(true);
    setError("");
    try {
      const r = await proxyApi.add(draft.trim());
      if (r.errors && r.errors.length) setError(`${r.added} added · skipped: ${r.errors.join("; ")}`);
      setDraft("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to add");
    } finally {
      setAdding(false);
    }
  };

  const act = async (id: number, fn: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await fn();
      load();
    } catch {
      /* ignore */
    } finally {
      setBusy(null);
    }
  };

  const saveSettings = (patch: Partial<ProxySettings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    proxyApi.saveSettings(next).catch(() => {});
  };

  const toggleProvider = (name: string) => {
    if (!settings) return;
    const has = settings.providers.includes(name);
    saveSettings({ providers: has ? settings.providers.filter((p) => p !== name) : [...settings.providers, name] });
  };

  return (
    <AppShell title="Proxy" subtitle="Outbound proxy pool">
      <div className="flex h-full flex-col gap-3">
        {/* Routing settings */}
        {settings && (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-white/80">Route requests through the pool</p>
                <p className="text-[10px] text-white/40">When on, upstream calls to the selected providers go through a proxy.</p>
              </div>
              <button
                onClick={() => saveSettings({ enabled: !settings.enabled })}
                className={`relative h-5 w-9 rounded-full transition-colors ${settings.enabled ? "bg-emerald-500/80" : "bg-white/15"}`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${settings.enabled ? "left-[18px]" : "left-0.5"}`} />
              </button>
            </div>
            {settings.enabled && (
              <div className="mt-3 space-y-2 border-t border-white/5 pt-3">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-white/50">Mode</span>
                  {(["rotate", "random", "sticky"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => saveSettings({ mode: m })}
                      className={`rounded-md px-2 py-0.5 text-[11px] ${settings.mode === m ? "bg-white/15 text-white" : "text-white/45 hover:bg-white/5"}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <div>
                  <span className="text-[11px] text-white/50">Providers ({settings.providers.length === 0 ? "all" : settings.providers.length})</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {providers.map((p) => {
                      const on = settings.providers.includes(p.name);
                      return (
                        <button
                          key={p.name}
                          onClick={() => toggleProvider(p.name)}
                          className={`rounded-md px-1.5 py-0.5 text-[10px] ${on ? "bg-indigo-500/25 text-indigo-200 ring-1 ring-inset ring-indigo-400/30" : "bg-white/5 text-white/40 hover:bg-white/10"}`}
                        >
                          {p.name}
                        </button>
                      );
                    })}
                    {settings.providers.length === 0 && <span className="text-[10px] text-white/30">none selected = all providers</span>}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Add */}
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add(); }}
              placeholder="Paste proxies — any format (host:port, socks5://user:pass@host:port, host:port:user:pass). One per line for bulk."
              rows={2}
              className="min-w-0 flex-1 resize-none rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 font-mono text-[11px] text-white/80 outline-none focus:border-white/25"
            />
            <button
              onClick={add}
              disabled={adding || !draft.trim()}
              className="flex shrink-0 items-center gap-1 self-stretch rounded-lg bg-white px-3 text-xs font-medium text-black hover:opacity-90 disabled:opacity-40"
            >
              {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
            </button>
          </div>
          {error && <p className="text-[10px] text-amber-300/80">{error}</p>}
        </div>

        {/* List */}
        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-white/10">
          {proxies === null ? (
            <div className="p-6 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-white/30" /></div>
          ) : proxies.length === 0 ? (
            <div className="p-6 text-center text-xs text-white/40">No proxies yet. Paste some above.</div>
          ) : (
            <div className="divide-y divide-white/5">
              {proxies.map((p) => (
                <div key={p.id} className={`flex items-center gap-2.5 px-3 py-2 text-xs ${!p.enabled ? "opacity-45" : ""}`}>
                  <StatusDot status={p.status} />
                  <span className="shrink-0 rounded bg-white/10 px-1 text-[9px] uppercase text-white/50">{p.scheme}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-white/80">
                    {p.host}:{p.port}
                    {p.username && <span className="text-white/35"> · {p.username}</span>}
                  </span>
                  {p.status === "ok" && p.latency_ms > 0 && <span className="shrink-0 tabular-nums text-emerald-300/70">{p.latency_ms}ms</span>}
                  <button onClick={() => act(p.id, () => proxyApi.test(p.id))} disabled={busy === p.id} title="Test" className="shrink-0 rounded p-1 text-white/40 hover:bg-white/10 hover:text-white disabled:opacity-40">
                    {busy === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}
                  </button>
                  <button onClick={() => act(p.id, () => proxyApi.toggle(p.id, !p.enabled))} title={p.enabled ? "Disable" : "Enable"} className={`shrink-0 rounded p-1 hover:bg-white/10 ${p.enabled ? "text-emerald-300/70" : "text-white/30"}`}>
                    <Power className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => act(p.id, () => proxyApi.del(p.id))} title="Delete" className="shrink-0 rounded p-1 text-white/40 hover:bg-red-500/30 hover:text-red-200">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between text-[10px] text-white/35">
          <span className="flex items-center gap-1"><Globe2 className="h-3 w-3" /> {proxies?.length ?? 0} proxies</span>
          <button onClick={load} className="flex items-center gap-1 hover:text-white/60"><RefreshCw className="h-3 w-3" /> Refresh</button>
        </div>
      </div>
    </AppShell>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === "ok" ? "bg-emerald-400" : status === "dead" ? "bg-red-400" : "bg-white/25";
  return <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} title={status} />;
}
