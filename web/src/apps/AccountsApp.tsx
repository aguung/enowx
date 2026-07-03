import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { shouldFlipUp } from "../components/Popover";
import { Search, Trash2, Power, PowerOff, RefreshCw, Zap, Boxes, X, Copy, Check, Plus, Play, Loader2, MoreVertical, Download } from "lucide-react";
import { AppShell } from "./shell";
import { ProviderIcon } from "../components/ProviderIcon";
import { Tooltip } from "../components/Tooltip";
import { accountsApi, providersApi, aliasesApi, type Account, type Provider, type Usage, type ProviderModel, type ModelAlias } from "../lib/api";
import { useDialog } from "../os/dialog";
import { startWarmup, finishWarmup } from "../os/warmupBus";
import { onUsageStale } from "../os/usageBus";

const STATUS_TONE: Record<string, string> = {
  active: "text-emerald-300 bg-emerald-500/10 ring-emerald-500/30",
  exhausted: "text-amber-300 bg-amber-500/10 ring-amber-500/30",
  banned: "text-red-300 bg-red-500/10 ring-red-500/30",
};

function statusTone(s: string) {
  return STATUS_TONE[s] ?? "text-white/50 bg-white/5 ring-white/15";
}

export function AccountsApp() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [warming, setWarming] = useState<number | null>(null);
  const [warmAll, setWarmAll] = useState<{ done: number; total: number } | null>(null);
  const [bulkMenu, setBulkMenu] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [usage, setUsage] = useState<Record<number, Usage>>({});
  const [modelsFor, setModelsFor] = useState<Account | null>(null);
  const dialog = useDialog();

  async function load() {
    try {
      const [a, p] = await Promise.all([accountsApi.list(), providersApi.list()]);
      setAccounts(a ?? []);
      setProviders(p ?? []);
      setError("");
      // Lazily fetch credit usage for accounts whose provider supports it.
      for (const acc of a ?? []) {
        accountsApi
          .usage(acc.id)
          .then((r) => {
            if (r.supported && r.usage && (r.usage.limit > 0 || (r.usage.windows?.length ?? 0) > 0)) {
              setUsage((m) => ({ ...m, [acc.id]: r.usage! }));
            }
          })
          .catch(() => {});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
      setAccounts([]);
    }
  }

  const accountsRef = useRef<Account[]>([]);
  useEffect(() => { accountsRef.current = accounts ?? []; }, [accounts]);

  useEffect(() => {
    load();
  }, []);

  // Refetch usage for accounts (optionally scoped to one provider).
  const refreshUsage = (provider?: string) => {
    for (const acc of accountsRef.current) {
      if (provider && acc.provider !== provider) continue;
      accountsApi.usage(acc.id).then((r) => {
        if (r.supported && r.usage) setUsage((m) => ({ ...m, [acc.id]: r.usage! }));
      }).catch(() => {});
    }
  };

  // Refresh credit when something elsewhere consumes quota (a Suno/Leonardo
  // generation in Chat signals this), and whenever the window regains focus (so
  // usage from API Test or an external call is picked up too).
  useEffect(() => {
    const off = onUsageStale((provider) => refreshUsage(provider));
    const onFocus = () => refreshUsage();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      off();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  const iconFor = (name: string) => providers.find((p) => p.name === name)?.icon ?? name;

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of accounts ?? []) m[a.provider] = (m[a.provider] ?? 0) + 1;
    return m;
  }, [accounts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (accounts ?? []).filter((a) => {
      if (filter !== "all" && a.provider !== filter) return false;
      if (!q) return true;
      return a.label.toLowerCase().includes(q) || a.provider.toLowerCase().includes(q);
    });
  }, [accounts, query, filter]);

  async function act(fn: () => Promise<unknown>, id: number) {
    setBusy(id);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "action failed");
    } finally {
      setBusy(null);
    }
  }

  const remove = async (a: Account) => {
    const ok = await dialog.confirm({
      title: "Delete account?",
      message: `${a.label || a.provider} will be removed from the pool. This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) act(() => accountsApi.remove(a.id), a.id);
  };
  const setDisabled = (a: Account, disabled: boolean) => act(() => accountsApi.setDisabled(a.id, disabled), a.id);

  async function warmup(a: Account) {
    setWarming(a.id);
    setError("");
    startWarmup({ accountId: a.id, provider: a.provider, label: a.label });
    try {
      const r = await accountsApi.warmup(a.id);
      if (r.usage && (r.usage.limit > 0 || (r.usage.windows?.length ?? 0) > 0)) setUsage((m) => ({ ...m, [a.id]: r.usage! }));
      if (!r.ok && r.error) setError(`${a.label || a.provider}: ${r.error}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "warmup failed");
    } finally {
      setWarming(null);
      finishWarmup(a.id);
    }
  }

  // warmupAll warms every account currently shown (i.e. matching the active
  // provider filter + search), skipping disabled ones. Sequential so we don't
  // hammer upstreams; progress drives the button label.
  async function warmupAll() {
    const targets = filtered.filter((a) => !a.disabled);
    if (targets.length === 0) return;
    setError("");
    setWarmAll({ done: 0, total: targets.length });
    let failures = 0;
    for (let i = 0; i < targets.length; i++) {
      const a = targets[i];
      setWarming(a.id);
      startWarmup({ accountId: a.id, provider: a.provider, label: a.label });
      try {
        const r = await accountsApi.warmup(a.id);
        if (r.usage && (r.usage.limit > 0 || (r.usage.windows?.length ?? 0) > 0)) setUsage((m) => ({ ...m, [a.id]: r.usage! }));
        if (!r.ok) failures++;
      } catch {
        failures++;
      } finally {
        finishWarmup(a.id);
        setWarming(null);
        setWarmAll({ done: i + 1, total: targets.length });
      }
    }
    await load();
    setWarmAll(null);
    if (failures > 0) setError(`${failures} of ${targets.length} account(s) failed to warm up.`);
    else setNotice(`Warmed up ${targets.length} account(s).`);
  }

  // bulkTargets picks accounts (within the active filter) matching a category.
  function bulkTargets(kind: "all" | "banned" | "exhausted" | "disabled"): Account[] {
    return filtered.filter((a) => {
      if (kind === "all") return true;
      if (kind === "disabled") return a.disabled;
      return a.status === kind;
    });
  }

  async function bulkDelete(kind: "all" | "banned" | "exhausted" | "disabled") {
    setBulkMenu(false);
    const targets = bulkTargets(kind);
    if (targets.length === 0) return;
    const scope = filter === "all" ? "" : ` ${filter}`;
    const ok = await dialog.confirm({
      title: `Delete ${targets.length}${scope} account(s)?`,
      message: `${kind === "all" ? "All shown" : `All ${kind}`}${scope} accounts will be removed from the pool. This cannot be undone.`,
      confirmLabel: `Delete ${targets.length}`,
      danger: true,
    });
    if (!ok) return;
    setBulkBusy(true);
    setError("");
    let failures = 0;
    for (const a of targets) {
      try {
        await accountsApi.remove(a.id);
      } catch {
        failures++;
      }
    }
    await load();
    setBulkBusy(false);
    if (failures > 0) setError(`${failures} of ${targets.length} account(s) failed to delete.`);
    else setNotice(`Deleted ${targets.length} account(s).`);
  }

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  async function apply(a: Account, target: "desktop" | "cli") {
    setError("");
    setBusy(a.id);
    try {
      const r = await accountsApi.apply(a.id, target);
      setNotice(r.message);
      if (r.launch_error) setError(`${a.label || a.provider}: ${r.launch_error}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "apply failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell title="Accounts" subtitle="The credential pool across providers">
      <div className="flex h-full flex-col">
        {/* Search on its own row so it stays full-width; controls below. */}
        <div className="mb-2 flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3">
          <Search className="h-4 w-4 shrink-0 text-white/30" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search accounts…"
            className="w-full bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none"
          />
        </div>
        <div className="mb-3 flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            title="Filter by provider"
            className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-xs text-white/80 focus:outline-none"
          >
            <option value="all" className="bg-[#15161c]">
              All providers
            </option>
            {Object.keys(counts).map((p) => (
              <option key={p} value={p} className="bg-[#15161c]">
                {p} ({counts[p]})
              </option>
            ))}
          </select>
          <Tooltip label={filter === "all" ? "Warm up all accounts" : `Warm up all ${filter} accounts`} place="bottom">
            <button
              onClick={warmupAll}
              disabled={!!warmAll || filtered.filter((a) => !a.disabled).length === 0}
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              {warmAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {warmAll ? `Warming ${warmAll.done}/${warmAll.total}` : "Warm all"}
            </button>
          </Tooltip>
          <div className="relative shrink-0">
            <Tooltip label="Delete accounts in bulk" place="bottom">
              <button
                onClick={() => setBulkMenu((o) => !o)}
                disabled={bulkBusy || filtered.length === 0}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-white/50 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"
              >
                {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </Tooltip>
            {bulkMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setBulkMenu(false)} />
                <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-white/10 bg-[#15161c] py-1 shadow-xl">
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-white/30">
                    Delete{filter !== "all" ? ` ${filter}` : ""}…
                  </div>
                  {([
                    ["banned", "Banned"],
                    ["exhausted", "Exhausted"],
                    ["disabled", "Disabled"],
                    ["all", "All shown"],
                  ] as const).map(([kind, label]) => {
                    const n = bulkTargets(kind).length;
                    return (
                      <button
                        key={kind}
                        onClick={() => bulkDelete(kind)}
                        disabled={n === 0}
                        className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-white/5 disabled:opacity-30 ${kind === "all" ? "text-red-300" : "text-white/80"}`}
                      >
                        <span>{label}</span>
                        <span className="text-white/40">{n}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <Tooltip label="Reload accounts" place="bottom">
            <button onClick={load} disabled={!!warmAll} className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-40">
              <RefreshCw className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>

        {error && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
        {notice && <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{notice}</div>}

        <div className="min-h-0 flex-1 overflow-auto">
          {accounts === null ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-white/5" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-sm text-white/40">
              {accounts.length === 0 ? "No accounts yet. Add one in Providers." : "No accounts match."}
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((a) => (
                <div
                  key={a.id}
                  className="group flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:bg-white/[0.05]"
                >
                  <div className="relative shrink-0">
                    <ProviderIcon icon={iconFor(a.provider)} label={a.provider} size={40} />
                    {usage[a.id]?.plan && (
                      <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-indigo-500 px-1.5 py-[1px] text-[8px] font-bold uppercase leading-none tracking-wide text-white shadow ring-1 ring-[var(--window-bg)]" title={`Plan: ${usage[a.id].plan}`}>
                        {usage[a.id].plan}
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`truncate text-sm font-medium ${a.disabled ? "text-white/45" : "text-white"}`}>
                        {a.label || `${a.provider} account`}
                      </span>
                      {a.disabled ? (
                        <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/45 ring-1 ring-inset ring-white/15">
                          disabled
                        </span>
                      ) : (
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ring-1 ring-inset ${statusTone(a.status)}`}>
                          {a.status}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/40">
                      <span className="capitalize">{a.provider}</span>
                      <span className="text-white/20">·</span>
                      <span>{a.created_at}</span>
                    </div>
                    {usage[a.id] && <CreditMeter u={usage[a.id]} />}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {warming === a.id && <Zap className="h-3.5 w-3.5 animate-pulse text-amber-300" />}
                    <Tooltip label="View accessible models">
                      <button
                        onClick={() => setModelsFor(a)}
                        disabled={busy === a.id}
                        className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-white/55 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                      >
                        <Boxes className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                    <AccountMenu
                      account={a}
                      busy={busy === a.id}
                      onWarmup={() => warmup(a)}
                      onApply={(t) => apply(a, t)}
                      onToggle={() => setDisabled(a, !a.disabled)}
                      onDelete={() => remove(a)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {modelsFor && <AccountModelsPanel account={modelsFor} onClose={() => setModelsFor(null)} />}
    </AppShell>
  );
}

// AccountModelsPanel is a centered modal listing the models an account can
// access (fetched live for fetchable providers, or the cloud catalog otherwise).
function AccountModelsPanel({ account, onClose }: { account: Account; onClose: () => void }) {
  const dialog = useDialog();
  const [data, setData] = useState<{ source: string; models: ProviderModel[] } | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [aliases, setAliases] = useState<ModelAlias[]>([]);
  useEffect(() => {
    accountsApi
      .models(account.id)
      .then((r) => setData({ source: r.source, models: r.models ?? [] }))
      .catch((e) => setErr(e instanceof Error ? e.message : "failed to load models"));
  }, [account.id]);
  const loadAliases = () => aliasesApi.list().then((r) => setAliases(r.aliases ?? [])).catch(() => setAliases([]));
  useEffect(() => { loadAliases(); }, []);

  async function addAlias(modelId: string) {
    const alias = await dialog.prompt({ title: "Add alias", message: `Call ${modelId} by a custom name`, placeholder: "e.g. gpro" });
    if (!alias || !alias.trim()) return;
    await aliasesApi.set(alias.trim(), modelId).catch(() => {});
    loadAliases();
  }
  async function removeAlias(alias: string) {
    await aliasesApi.remove(alias).catch(() => {});
    loadAliases();
  }
  const aliasesFor = (modelId: string) => aliases.filter((a) => a.target === modelId);
  const shown = (data?.models ?? []).filter(
    (m) => !q || m.name.toLowerCase().includes(q.toLowerCase()) || m.model_id.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div className="fixed inset-0 z-[10600] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0e1016] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-white">Models · {account.label || account.provider}</div>
            <div className="text-[11px] text-white/40">
              <span className="capitalize">{account.provider}</span>
              {data && <span className="ml-1 rounded bg-white/10 px-1.5 py-0.5">{data.source === "upstream" ? "live" : "catalog"}</span>}
              {data && <span className="ml-1">· {data.models.length} models</span>}
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-white/50 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        {data && data.models.length > 6 && (
          <div className="border-b border-white/5 px-4 py-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter models…" className="w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs text-white outline-none focus:border-white/25" />
          </div>
        )}
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
          {err && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{err}</div>}
          {!data && !err && <div className="h-16 animate-pulse rounded-lg bg-white/5" />}
          {data && shown.length === 0 && <div className="text-[11px] text-white/40">No models found.</div>}
          {shown.map((m) => <ModelRow key={m.model_id} m={m} accountId={account.id} aliases={aliasesFor(m.model_id)} onAddAlias={() => addAlias(m.model_id)} onRemoveAlias={removeAlias} />)}
        </div>
      </div>
    </div>
  );
}

// ModelRow renders one model with context sizes, a copy-id button, and the
// user's LOCAL aliases (add/remove your own custom name for this model).
function ModelRow({ m, accountId, aliases, onAddAlias, onRemoveAlias }: { m: ProviderModel; accountId: number; aliases: ModelAlias[]; onAddAlias: () => void; onRemoveAlias: (alias: string) => void }) {
  const [copied, setCopied] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const copy = () => {
    navigator.clipboard?.writeText(m.model_id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const r = await accountsApi.testModel(accountId, m.model_id, m.type);
      setResult({ ok: r.ok, text: r.ok ? `${(r.response || "ok").slice(0, 80)} · ${r.latency}ms` : (r.error || "failed") });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "failed" });
    } finally {
      setTesting(false);
    }
  };
  const ctx = (n?: number) => (n && n > 0 ? (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`) : null);
  const inTok = ctx(m.max_input), outTok = ctx(m.max_output);
  return (
    <div className="group rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm text-white">{m.name}</span>
            {m.type === "image" && <span className="rounded bg-fuchsia-500/20 px-1 text-[9px] text-fuchsia-300">IMG</span>}
            {m.type === "music" && <span className="rounded bg-violet-500/20 px-1 text-[9px] text-violet-300">MUSIC</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-white/35">
            <span className="font-mono">{m.model_id}</span>
            {m.owned_by && <span>· {m.owned_by}</span>}
            {inTok && <span>· in {inTok}</span>}
            {outTok && <span>· out {outTok}</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {aliases.map((a) => (
              <span key={a.alias} className="group/a flex items-center gap-0.5 rounded bg-indigo-500/15 px-1.5 py-0.5 font-mono text-[9px] text-indigo-300">
                {a.alias}
                <button onClick={() => onRemoveAlias(a.alias)} className="opacity-60 hover:opacity-100"><X className="h-2.5 w-2.5" /></button>
              </span>
            ))}
            <button onClick={onAddAlias} className="flex items-center gap-0.5 rounded border border-dashed border-white/15 px-1.5 py-0.5 text-[9px] text-white/40 hover:border-white/30 hover:text-white/70"><Plus className="h-2.5 w-2.5" /> alias</button>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
          {m.type !== "music" && (
            <button onClick={test} disabled={testing} title="Test model" className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white disabled:opacity-50">
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            </button>
          )}
          <button onClick={copy} title="Copy model id" className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white">
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {result && (
        <div className={`mt-1.5 flex items-start gap-1.5 rounded border px-2 py-1 text-[10px] ${result.ok ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300" : "border-red-500/25 bg-red-500/10 text-red-300"}`}>
          {result.ok ? <Check className="mt-[1px] h-3 w-3 shrink-0" /> : <X className="mt-[1px] h-3 w-3 shrink-0" />}
          <span className="min-w-0 break-words">{result.text}</span>
        </div>
      )}
    </div>
  );
}

const fmtCredit = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : `${Math.round(n)}`;

// remainingTone colors a bar by how much is LEFT: green plenty, amber getting
// low, red almost out.
function remainingTone(remainPct: number): string {
  return remainPct <= 10 ? "bg-red-400" : remainPct <= 30 ? "bg-amber-400" : "bg-emerald-400";
}

function CreditMeter({ u }: { u: Usage }) {
  // Window-based providers (e.g. Codex/Antigravity) show a bar per window — the
  // bar length is the REMAINING fraction.
  if (u.windows && u.windows.length > 0) {
    return (
      <div className="mt-2 max-w-[220px] space-y-1.5">
        {u.windows.map((w, i) => {
          const remain = Math.max(0, Math.min(100, Math.round(100 - w.used_percent)));
          return (
            <div key={i}>
              <div className="mb-0.5 flex items-center justify-between text-[10px] text-white/40">
                <span>{w.label}</span>
                <span className="tabular-nums">{remain}% left{w.reset_in_secs ? ` · ${fmtReset(w.reset_in_secs)}` : ""}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className={`h-full rounded-full ${remainingTone(remain)}`} style={{ width: `${remain}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  const remain = u.limit > 0 ? Math.max(0, Math.min(100, Math.round((u.remaining / u.limit) * 100))) : 0;
  return (
    <div className="mt-2 max-w-[220px]">
      <div className="mb-1 flex items-center justify-between text-[10px] text-white/40">
        <span>credit left</span>
        <span className="tabular-nums">
          {fmtCredit(u.remaining)} / {fmtCredit(u.limit)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${remainingTone(remain)}`} style={{ width: `${remain}%` }} />
      </div>
    </div>
  );
}

// fmtReset turns a "resets in N seconds" into a short human string.
function fmtReset(secs: number): string {
  if (secs >= 86400) return `${Math.round(secs / 86400)}d`;
  if (secs >= 3600) return `${Math.round(secs / 3600)}h`;
  if (secs >= 60) return `${Math.round(secs / 60)}m`;
  return `${secs}s`;
}

// AccountMenu is the per-account 3-dot dropdown of actions. Apply items only
// show when the account's creds can be written to a local IDE/CLI.
function AccountMenu({
  account,
  busy,
  onWarmup,
  onApply,
  onToggle,
  onDelete,
}: {
  account: Account;
  busy: boolean;
  onWarmup: () => void;
  onApply: (target: "desktop" | "cli") => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Flip the menu upward when it would be clipped by the bottom of the viewport.
  useLayoutEffect(() => {
    if (!open || !menuRef.current) return;
    setUp(shouldFlipUp(menuRef.current));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const item = "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-white/75 hover:bg-white/10 disabled:opacity-40";
  const canApply = account.can_apply;
  const isKiro = account.provider === "kiro";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-white/55 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
        title="Actions"
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div ref={menuRef} className={`absolute right-0 z-30 w-44 overflow-hidden rounded-lg border border-white/10 bg-[#14161d] py-1 shadow-xl ${up ? "bottom-full mb-1" : "mt-1"}`}>
          <button className={item} onClick={run(onWarmup)}>
            <Zap className="h-3.5 w-3.5" /> Warm up
          </button>
          {canApply && (
            <>
              <div className="my-1 border-t border-white/5" />
              <button className={item} onClick={run(() => onApply("desktop"))}>
                <Download className="h-3.5 w-3.5" /> Apply to {isKiro ? "IDE" : "app"}
              </button>
              {isKiro && (
                <button className={item} onClick={run(() => onApply("cli"))}>
                  <Download className="h-3.5 w-3.5" /> Apply to CLI
                </button>
              )}
            </>
          )}
          <div className="my-1 border-t border-white/5" />
          <button className={item} onClick={run(onToggle)}>
            {account.disabled ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
            {account.disabled ? "Enable" : "Disable"}
          </button>
          <button className={`${item} text-red-300 hover:bg-red-500/20`} onClick={run(onDelete)}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}
