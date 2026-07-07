import { useEffect, useMemo, useState } from "react";
import { Search, Plus, X, Trash2, Loader2, Settings, Check} from "lucide-react";
import { AppShell } from "./shell";
import { ProviderIcon } from "../components/ProviderIcon";
import { AddAccountModal } from "../components/AddAccountModal";
import { KiroAddModal } from "../components/KiroAddModal";
import { ClaudeAddModal } from "../components/ClaudeAddModal";
import { CodexAddModal } from "../components/CodexAddModal";
import { AntigravityAddModal } from "../components/AntigravityAddModal";
import { LeonardoAddModal } from "../components/LeonardoAddModal";
import { useDialog } from "../os/dialog";
import { providersApi, accountsApi, customProviderApi, type Provider, type Account, type CustomModel, rotationApi} from "../lib/api";

export function ProvidersApp() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<Provider | null>(null);
  const [addingProvider, setAddingProvider] = useState(false);
  const dialog = useDialog();

  // Load providers and accounts independently: the provider list is small, so
  // clear the skeleton as soon as it arrives instead of waiting on the (large)
  // account list — accounts only feed the per-provider counts and can fill in
  // after. An `alive` guard prevents a stale load from overwriting newer state.
  async function load(alive: () => boolean = () => true) {
    providersApi
      .list()
      .then((p) => { if (alive()) { setProviders(p); setError(""); } })
      .catch((e) => { if (alive()) setError(e instanceof Error ? e.message : "failed to load"); })
      .finally(() => { if (alive()) setLoading(false); });
    accountsApi
      .list()
      .then((a) => { if (alive()) setAccounts(a ?? []); })
      .catch(() => {});
  }

  useEffect(() => {
    let on = true;
    load(() => on);
    return () => { on = false; };
  }, []);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of accounts) m[a.provider] = (m[a.provider] ?? 0) + 1;
    return m;
  }, [accounts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return providers;
    return providers.filter(
      (p) => p.label.toLowerCase().includes(q) || p.name.toLowerCase().includes(q),
    );
  }, [providers, query]);

  return (
    <AppShell title="Providers" subtitle="Upstream providers and their accounts">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
          <Search className="h-4 w-4 text-white/30" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search providers..."
            className="w-full bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none"
          />
        </div>
        <button onClick={() => setAddingProvider(true)} className="flex shrink-0 items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-medium text-black hover:opacity-90"><Plus className="h-3.5 w-3.5" /> Add provider</button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[88px] animate-pulse rounded-2xl border border-white/5 bg-white/[0.02]" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-sm text-white/40">
          No providers match "{query}".
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }}>
          {filtered.map((p) => (
            <ProviderCard
              key={p.name}
              provider={p}
              count={counts[p.name] ?? 0}
              onAdd={() => setAdding(p)}
              onDelete={p.custom ? async () => {
                const ok = await dialog.confirm({ title: `Delete ${p.label}?`, message: "This removes the custom provider and all its accounts.", confirmLabel: "Delete", danger: true });
                if (!ok) return;
                const cp = await customProviderApi.list().then((r) => r.providers.find((x) => x.name === p.name));
                if (cp) { await customProviderApi.remove(cp.id); load(); }
              } : undefined}
            />
          ))}
        </div>
      )}

      {adding && adding.name === "kiro" && (
        <KiroAddModal
          provider={adding}
          onClose={() => setAdding(null)}
          onSaved={() => {
            setAdding(null);
            load();
          }}
        />
      )}
      {adding && adding.name === "codex" && (
        <CodexAddModal
          provider={adding}
          onClose={() => setAdding(null)}
          onSaved={() => {
            setAdding(null);
            load();
          }}
        />
      )}
      {adding && adding.name === "antigravity" && (
        <AntigravityAddModal
          provider={adding}
          onClose={() => setAdding(null)}
          onSaved={() => {
            setAdding(null);
            load();
          }}
        />
      )}
      {adding && adding.name === "leonardo" && (
        <LeonardoAddModal
          provider={adding}
          onClose={() => setAdding(null)}
          onSaved={() => {
            setAdding(null);
            load();
          }}
        />
      )}
      {adding && adding.name === "claudecode" && (
        <ClaudeAddModal
          provider={adding}
          onClose={() => setAdding(null)}
          onSaved={() => {
            setAdding(null);
            load();
          }}
        />
      )}
      {adding && adding.name !== "kiro" && adding.name !== "codex" && adding.name !== "claudecode" && adding.name !== "antigravity" && adding.name !== "leonardo" && (
        <AddAccountModal
          provider={adding}
          onClose={() => setAdding(null)}
          onSaved={() => {
            setAdding(null);
            load();
          }}
        />
      )}
      {addingProvider && <AddProviderModal onClose={() => setAddingProvider(false)} onSaved={() => { setAddingProvider(false); load(); }} />}
    </AppShell>
  );
}

function ProviderCard({
  provider,
  count,
  onAdd,
  onDelete,
}: {
  provider: Provider;
  count: number;
  onAdd: () => void;
  onDelete?: () => void;
}) {
  const [rotOpen, setRotOpen] = useState(false);
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 transition-colors hover:bg-white/[0.06]">
      <div className="flex items-start gap-3">
        <div className="relative shrink-0 overflow-hidden rounded-xl">
          <ProviderIcon icon={provider.icon} label={provider.label} size={44} />
          {provider.custom && <span className="absolute inset-x-0 bottom-0 bg-indigo-500/90 py-px text-center text-[7px] font-bold uppercase leading-none text-white" title="Custom provider">custom</span>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{provider.label}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-white/40">
            <span className="rounded-md bg-white/5 px-1.5 py-0.5">
              {count} {count === 1 ? "account" : "accounts"}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5">
        <button
          onClick={onAdd}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/10"
        >
          <Plus className="h-3.5 w-3.5" /> Add account
        </button>
        <button onClick={() => setRotOpen(true)} title="Account rotation" className="shrink-0 rounded-lg border border-white/10 bg-white/5 p-1.5 text-white/40 hover:bg-white/10 hover:text-white/80"><Settings className="h-3.5 w-3.5" /></button>
        {onDelete && (
          <button onClick={onDelete} title="Delete provider" className="shrink-0 rounded-lg border border-white/10 bg-white/5 p-1.5 text-white/40 hover:bg-red-500/20 hover:text-red-200"><Trash2 className="h-3.5 w-3.5" /></button>
        )}
      </div>
      {rotOpen && <RotationModal provider={provider.name} onClose={() => setRotOpen(false)} />}
    </div>
  );
}

// RotationModal is a popup to pick sticky vs round-robin account selection for a
// provider. Sticky keeps one account until it dies; round-robin spreads requests
// across accounts so no single one carries all the traffic (useful for ban-
// sensitive providers). Available for every provider, including custom ones.
function RotationModal({ provider, onClose }: { provider: string; onClose: () => void }) {
  const [mode, setMode] = useState<"sticky" | "round-robin" | null>(null);
  useEffect(() => { rotationApi.get(provider).then((r) => setMode(r.mode === "round-robin" ? "round-robin" : "sticky")).catch(() => setMode("sticky")); }, [provider]);
  const set = async (m: "sticky" | "round-robin") => { setMode(m); try { await rotationApi.set(provider, m); } catch { /* revert on next load */ } };
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#14161c] p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-white"><Settings className="h-4 w-4 text-white/60" /> Account rotation</div>
          <button onClick={onClose} className="rounded-md p-1 text-white/50 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 text-[11px] leading-snug text-white/45">How the next account is chosen for each request. Either way, a failed account is skipped automatically and in-flight streams are never interrupted.</p>
        {mode === null ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-white/30" /></div>
        ) : (
          <div className="space-y-2">
            <button onClick={() => set("sticky")} className={`w-full rounded-xl border p-3 text-left transition-colors ${mode === "sticky" ? "border-sky-400/40 bg-sky-500/10" : "border-white/10 hover:bg-white/5"}`}>
              <div className="flex items-center justify-between"><span className="text-sm font-medium text-white">Sticky</span>{mode === "sticky" && <Check className="h-4 w-4 text-sky-300" />}</div>
              <p className="mt-0.5 text-[11px] text-white/45">Keep using one account; only move to the next when it stops working. Default.</p>
            </button>
            <button onClick={() => set("round-robin")} className={`w-full rounded-xl border p-3 text-left transition-colors ${mode === "round-robin" ? "border-sky-400/40 bg-sky-500/10" : "border-white/10 hover:bg-white/5"}`}>
              <div className="flex items-center justify-between"><span className="text-sm font-medium text-white">Round-robin</span>{mode === "round-robin" && <Check className="h-4 w-4 text-sky-300" />}</div>
              <p className="mt-0.5 text-[11px] text-white/45">Rotate through all accounts each request to spread the load.</p>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// AddProviderModal creates a user-defined OpenAI/Anthropic-compatible provider.
function AddProviderModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [format, setFormat] = useState<"openai" | "anthropic">("openai");
  const [baseURL, setBaseURL] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<CustomModel[]>([]);
  const [newModel, setNewModel] = useState("");
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const fetchModels = async () => {
    if (!baseURL.trim()) { setErr("Enter the base URL first."); return; }
    setFetching(true); setErr("");
    try {
      const r = await customProviderApi.probe(baseURL.trim(), format, apiKey.trim());
      setModels(r.models ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "couldn't fetch models — add them manually");
    } finally {
      setFetching(false);
    }
  };

  const addManual = () => {
    const id = newModel.trim();
    if (!id || models.some((m) => m.id === id)) return;
    setModels([...models, { id, name: id }]);
    setNewModel("");
  };

  const save = async () => {
    if (!name.trim() || !prefix.trim() || !baseURL.trim()) { setErr("Name, prefix and base URL are required."); return; }
    if (models.length === 0) { setErr("Add at least one model (fetch or manual)."); return; }
    setSaving(true); setErr("");
    try {
      await customProviderApi.create({ name: name.trim(), prefix: prefix.trim().toLowerCase(), format, base_url: baseURL.trim(), default_model: models[0]?.id ?? "", models, api_key: apiKey.trim() });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to create");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[90%] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#11131a] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
          <div className="flex-1 text-sm font-semibold text-white">Add custom provider</div>
          <button onClick={onClose} className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
          <div className="flex gap-2">
            <div className="flex-1"><label className="mb-1 block text-[11px] text-white/50">Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="My API" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/25" /></div>
            <div className="w-28"><label className="mb-1 block text-[11px] text-white/50">Prefix</label><input value={prefix} onChange={(e) => setPrefix(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="myapi" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:border-white/25" /></div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-white/50">Format</label>
            <div className="flex gap-1">
              <button onClick={() => setFormat("openai")} className={`rounded-lg px-3 py-1.5 text-xs ${format === "openai" ? "bg-white/12 text-white" : "text-white/45 hover:bg-white/5"}`}>OpenAI (/chat/completions)</button>
              <button onClick={() => setFormat("anthropic")} className={`rounded-lg px-3 py-1.5 text-xs ${format === "anthropic" ? "bg-white/12 text-white" : "text-white/45 hover:bg-white/5"}`}>Anthropic (/v1/messages)</button>
            </div>
          </div>
          <div><label className="mb-1 block text-[11px] text-white/50">Base URL</label><input value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="https://api.example.com/v1" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:border-white/25" /></div>
          <div><label className="mb-1 block text-[11px] text-white/50">API key (becomes the first account; also used to fetch models)</label><input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" placeholder="sk-…" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/25" /></div>

          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-white/60">Models {models.length > 0 && <span className="text-white/40">({models.length})</span>}</span>
              <button onClick={fetchModels} disabled={fetching} className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/70 hover:bg-white/5 disabled:opacity-50">{fetching ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Fetch models</button>
            </div>
            <p className="mb-2 text-[10px] text-white/35">All these models are added to every account under this provider.</p>
            {models.length > 0 && (
              <div className="mb-2 max-h-32 space-y-1 overflow-auto">
                {models.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 text-xs text-white/70">
                    <span className="flex-1 truncate font-mono">{m.id}</span>
                    <button onClick={() => setModels(models.filter((x) => x.id !== m.id))} className="text-white/30 hover:text-red-300"><X className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-1">
              <input value={newModel} onChange={(e) => setNewModel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addManual()} placeholder="add model id manually…" className="flex-1 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-white outline-none focus:border-white/25" />
              <button onClick={addManual} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/60 hover:bg-white/5">Add</button>
            </div>
          </div>
          {err && <div className="text-xs text-red-300">{err}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-white/5 px-4 py-3">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-white/50 hover:text-white">Cancel</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 rounded-lg bg-white px-4 py-1.5 text-xs font-medium text-black hover:opacity-90 disabled:opacity-50">{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Create provider</button>
        </div>
      </div>
    </div>
  );
}
