import { useEffect, useState } from "react";
import { Plus, Trash2, Wifi, Loader2, Power, RefreshCw, Globe2, X, Settings } from "lucide-react";
import { AppShell } from "./shell";
import { proxyApi, providersApi, type ProxyItem, type ProxySettings, type Provider } from "../lib/api";

// ProxyApp manages the outbound proxy pool: add proxies in any format, test
// them, toggle/delete, and configure which providers route through the pool.
export function ProxyApp() {
  const [proxies, setProxies] = useState<ProxyItem[] | null>(null);
  const [settings, setSettings] = useState<ProxySettings | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  const load = () => {
    proxyApi.list().then((r) => setProxies(r.proxies)).catch(() => setProxies([]));
    proxyApi.getSettings().then(setSettings).catch(() => {});
  };
  useEffect(() => {
    load();
    providersApi.list().then(setProviders).catch(() => {});
  }, []);

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
        {/* Pool header: routing status + settings + add */}
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px] text-white/40">
            <Globe2 className="h-3 w-3" /> {proxies?.length ?? 0} proxies
            {settings && (
              <span className={`ml-1 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${settings.enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-white/35"}`}>
                {settings.enabled ? `routing · ${settings.mode}` : "routing off"}
              </span>
            )}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowSettings(true)}
              title="Routing settings"
              className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-white/55 hover:bg-white/10 hover:text-white"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" /> Add proxies
            </button>
          </div>
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

        <div className="flex items-center justify-end text-[10px] text-white/35">
          <button onClick={load} className="flex items-center gap-1 hover:text-white/60"><RefreshCw className="h-3 w-3" /> Refresh</button>
        </div>
      </div>

      {showAdd && <AddModal onClose={() => setShowAdd(false)} onDone={load} />}
      {showSettings && settings && (
        <SettingsModal
          settings={settings}
          providers={providers}
          onSave={saveSettings}
          onToggleProvider={toggleProvider}
          onClose={() => setShowSettings(false)}
        />
      )}
    </AppShell>
  );
}

// AddModal collects a paste of proxies (any format, one per line for bulk) with
// an option to test them immediately after adding.
function AddModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [testAfter, setTestAfter] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ added: number; errors: string[] } | null>(null);

  const submit = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    setResult(null);
    try {
      const r = await proxyApi.add(text.trim());
      const errors = r.errors ?? [];
      setResult({ added: r.added, errors });
      onDone();
      if (testAfter && r.added > 0) {
        // Test the newly-added (any "unknown"/untested) proxies in the background.
        const list = await proxyApi.list();
        const fresh = list.proxies.filter((p) => p.status === "unknown");
        await Promise.allSettled(fresh.map((p) => proxyApi.test(p.id)));
        onDone();
      }
      if (errors.length === 0) {
        onClose();
      } else {
        setText(""); // keep the modal open to show which lines were skipped
      }
    } catch (e) {
      setResult({ added: 0, errors: [e instanceof Error ? e.message : "failed to add"] });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#11131a] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <p className="text-sm font-semibold text-white">Add proxies</p>
          <button onClick={onClose} className="rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 px-4 py-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
            placeholder={"One per line, any format:\nhost:port\nsocks5://user:pass@host:port\nhost:port:user:pass\nip:port"}
            rows={6}
            className="w-full resize-none rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 font-mono text-[11px] text-white/80 outline-none focus:border-white/25"
          />
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-white/60">
            <input type="checkbox" checked={testAfter} onChange={(e) => setTestAfter(e.target.checked)} className="h-3.5 w-3.5 accent-cyan-500" />
            Test proxies right after adding
          </label>
          {result && result.errors.length > 0 && (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-[10px] text-amber-200/90">
              {result.added} added · {result.errors.length} skipped:
              <ul className="mt-0.5 list-disc pl-4">{result.errors.slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-white/5 px-4 py-3">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-white/50 hover:bg-white/5 hover:text-white">Cancel</button>
          <button
            onClick={submit}
            disabled={saving || !text.trim()}
            className="flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black hover:opacity-90 disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {testAfter ? "Add & test" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

// SettingsModal holds the routing config: master toggle, mode, and which
// providers route through the pool.
function SettingsModal({
  settings,
  providers,
  onSave,
  onToggleProvider,
  onClose,
}: {
  settings: ProxySettings;
  providers: Provider[];
  onSave: (patch: Partial<ProxySettings>) => void;
  onToggleProvider: (name: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#11131a] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <p className="text-sm font-semibold text-white">Routing settings</p>
          <button onClick={onClose} className="rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-white/80">Route requests through the pool</p>
              <p className="text-[10px] text-white/40">Upstream calls to the selected providers go through a proxy.</p>
            </div>
            <button
              onClick={() => onSave({ enabled: !settings.enabled })}
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${settings.enabled ? "bg-emerald-500/80" : "bg-white/15"}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${settings.enabled ? "left-[18px]" : "left-0.5"}`} />
            </button>
          </div>

          <div className={settings.enabled ? "" : "pointer-events-none opacity-40"}>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-white/50">Mode</span>
              {(["rotate", "random", "sticky"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => onSave({ mode: m })}
                  className={`rounded-md px-2 py-0.5 text-[11px] ${settings.mode === m ? "bg-white/15 text-white" : "text-white/45 hover:bg-white/5"}`}
                >
                  {m}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-white/30">
              {settings.mode === "rotate" && "Round-robin: cycle through proxies per request."}
              {settings.mode === "random" && "Pick a random proxy each request."}
              {settings.mode === "sticky" && "One proxy per provider, reused across requests."}
            </p>

            <div className="mt-3">
              <span className="text-[11px] text-white/50">Providers ({settings.providers.length === 0 ? "all" : settings.providers.length})</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {providers.map((p) => {
                  const on = settings.providers.includes(p.name);
                  return (
                    <button
                      key={p.name}
                      onClick={() => onToggleProvider(p.name)}
                      className={`rounded-md px-1.5 py-0.5 text-[10px] ${on ? "bg-indigo-500/25 text-indigo-200 ring-1 ring-inset ring-indigo-400/30" : "bg-white/5 text-white/40 hover:bg-white/10"}`}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
              {settings.providers.length === 0 && <p className="mt-1 text-[10px] text-white/30">None selected = all providers routed.</p>}
            </div>
          </div>

          {/* Auto health-check: re-test every proxy on a schedule. Independent of routing. */}
          <div className="mt-4 border-t border-white/5 pt-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-white/85">Auto health-check</div>
                <div className="text-[10px] text-white/40">Re-test every proxy on a schedule and update its status.</div>
              </div>
              <button
                onClick={() => onSave({ autocheck_enabled: !settings.autocheck_enabled })}
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${settings.autocheck_enabled ? "bg-emerald-500/80" : "bg-white/15"}`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${settings.autocheck_enabled ? "left-[18px]" : "left-0.5"}`} />
              </button>
            </div>
            <div className={`mt-2 flex items-center gap-2 ${settings.autocheck_enabled ? "" : "pointer-events-none opacity-40"}`}>
              <span className="text-[11px] text-white/50">Every</span>
              <input
                type="number"
                min={1}
                max={1440}
                value={settings.autocheck_minutes}
                onChange={(e) => onSave({ autocheck_minutes: Math.min(1440, Math.max(1, Number(e.target.value) || 30)) })}
                className="w-16 rounded-md border border-white/10 bg-black/25 px-2 py-1 text-xs text-white/80 outline-none focus:border-white/25"
              />
              <span className="text-[11px] text-white/50">minutes</span>
            </div>
          </div>
        </div>
        <div className="flex justify-end border-t border-white/5 px-4 py-3">
          <button onClick={onClose} className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black hover:opacity-90">Done</button>
        </div>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === "ok" ? "bg-emerald-400" : status === "dead" ? "bg-red-400" : "bg-white/25";
  return <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} title={status} />;
}
