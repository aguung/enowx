import { useEffect, useMemo, useState } from "react";
import { Search, Trash2, Power, PowerOff, RefreshCw, Zap } from "lucide-react";
import { AppShell } from "./shell";
import { ProviderIcon } from "../components/ProviderIcon";
import { Tooltip } from "../components/Tooltip";
import { accountsApi, providersApi, type Account, type Provider, type Usage } from "../lib/api";

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
  const [busy, setBusy] = useState<number | null>(null);
  const [warming, setWarming] = useState<number | null>(null);
  const [usage, setUsage] = useState<Record<number, Usage>>({});

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
            if (r.supported && r.usage && r.usage.limit > 0) {
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

  useEffect(() => {
    load();
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

  const remove = (a: Account) => {
    if (!confirm(`Delete ${a.label || a.provider} account?`)) return;
    act(() => accountsApi.remove(a.id), a.id);
  };
  const setDisabled = (a: Account, disabled: boolean) => act(() => accountsApi.setDisabled(a.id, disabled), a.id);

  async function warmup(a: Account) {
    setWarming(a.id);
    setError("");
    try {
      const r = await accountsApi.warmup(a.id);
      if (r.usage && r.usage.limit > 0) setUsage((m) => ({ ...m, [a.id]: r.usage! }));
      if (!r.ok && r.error) setError(`${a.label || a.provider}: ${r.error}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "warmup failed");
    } finally {
      setWarming(null);
    }
  }

  return (
    <AppShell title="Accounts" subtitle="The credential pool across providers">
      <div className="flex h-full flex-col">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-10 flex-1 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3">
            <Search className="h-4 w-4 shrink-0 text-white/30" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search accounts…"
              className="w-full bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none"
            />
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            title="Filter by provider"
            className="h-10 shrink-0 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-xs text-white/80 focus:outline-none"
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
          <Tooltip label="Reload accounts" place="bottom">
            <button onClick={load} className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-white/50 hover:bg-white/10 hover:text-white">
              <RefreshCw className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>

        {error && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

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
                  <ProviderIcon icon={iconFor(a.provider)} label={a.provider} size={40} />

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
                      {usage[a.id]?.plan && (
                        <>
                          <span className="text-white/20">·</span>
                          <span className="capitalize">{usage[a.id].plan}</span>
                        </>
                      )}
                    </div>
                    {usage[a.id] && <CreditMeter u={usage[a.id]} />}
                  </div>

                  <div className="flex shrink-0 items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                    <ActionBtn title="Warm up (test request + credit)" disabled={busy === a.id || warming === a.id} onClick={() => warmup(a)}>
                      <Zap className={`h-3.5 w-3.5 ${warming === a.id ? "animate-pulse text-amber-300" : ""}`} />
                    </ActionBtn>
                    {a.disabled ? (
                      <ActionBtn title="Enable account" disabled={busy === a.id} onClick={() => setDisabled(a, false)}>
                        <Power className="h-3.5 w-3.5" />
                      </ActionBtn>
                    ) : (
                      <ActionBtn title="Disable account" disabled={busy === a.id} onClick={() => setDisabled(a, true)}>
                        <PowerOff className="h-3.5 w-3.5" />
                      </ActionBtn>
                    )}
                    <ActionBtn title="Delete account" danger disabled={busy === a.id} onClick={() => remove(a)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </ActionBtn>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

const fmtCredit = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : `${Math.round(n)}`;

function CreditMeter({ u }: { u: Usage }) {
  const pct = u.limit > 0 ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0;
  const tone = pct >= 90 ? "bg-red-400" : pct >= 70 ? "bg-amber-400" : "bg-emerald-400";
  return (
    <div className="mt-2 max-w-[220px]">
      <div className="mb-1 flex items-center justify-between text-[10px] text-white/40">
        <span>credit</span>
        <span className="tabular-nums">
          {fmtCredit(u.used)} / {fmtCredit(u.limit)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ActionBtn({
  title,
  onClick,
  disabled,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={title}>
      <button
        onClick={onClick}
        disabled={disabled}
        className={`rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-white/55 transition-colors disabled:opacity-40 ${
          danger ? "hover:bg-red-500/30 hover:text-red-200" : "hover:bg-white/10 hover:text-white"
        }`}
      >
        {children}
      </button>
    </Tooltip>
  );
}
