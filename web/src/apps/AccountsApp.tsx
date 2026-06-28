import { useEffect, useMemo, useState } from "react";
import { Search, Trash2, Ban, CircleCheck, RefreshCw } from "lucide-react";
import { AppShell } from "./shell";
import { ProviderIcon } from "../components/ProviderIcon";
import { accountsApi, providersApi, type Account, type Provider } from "../lib/api";

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

  async function load() {
    try {
      const [a, p] = await Promise.all([accountsApi.list(), providersApi.list()]);
      setAccounts(a ?? []);
      setProviders(p ?? []);
      setError("");
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
  const setStatus = (a: Account, status: string) => act(() => accountsApi.setStatus(a.id, status), a.id);

  const filterTabs = ["all", ...Object.keys(counts)];

  return (
    <AppShell title="Accounts" subtitle="The credential pool across providers">
      <div className="flex h-full flex-col">
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
          <Search className="h-4 w-4 text-white/30" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search accounts…"
            className="w-full bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none"
          />
          <button onClick={load} title="Refresh" className="rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        {filterTabs.length > 1 && (
          <div className="mb-3 flex flex-wrap gap-1">
            {filterTabs.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-2.5 py-1 text-[11px] capitalize transition-colors ${
                  filter === f ? "bg-white/12 text-white" : "text-white/50 hover:bg-white/5 hover:text-white/80"
                }`}
              >
                {f}
                {f !== "all" && <span className="ml-1 text-white/30">{counts[f]}</span>}
              </button>
            ))}
          </div>
        )}

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
                <div key={a.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <ProviderIcon icon={iconFor(a.provider)} label={a.provider} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-white">{a.label || `${a.provider} account`}</span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ring-1 ring-inset ${statusTone(a.status)}`}>
                        {a.status}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-white/35">
                      <span>{a.provider}</span>
                      <span>·</span>
                      <span>{a.created_at}</span>
                      {a.has.length > 0 && (
                        <>
                          <span>·</span>
                          <span className="truncate font-mono">{a.has.join(", ")}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {a.status === "active" ? (
                      <ActionBtn title="Ban" disabled={busy === a.id} onClick={() => setStatus(a, "banned")}>
                        <Ban className="h-3.5 w-3.5" />
                      </ActionBtn>
                    ) : (
                      <ActionBtn title="Activate" disabled={busy === a.id} onClick={() => setStatus(a, "active")}>
                        <CircleCheck className="h-3.5 w-3.5" />
                      </ActionBtn>
                    )}
                    <ActionBtn title="Delete" danger disabled={busy === a.id} onClick={() => remove(a)}>
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
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-white/55 transition-colors disabled:opacity-40 ${
        danger ? "hover:bg-red-500/30 hover:text-red-200" : "hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
