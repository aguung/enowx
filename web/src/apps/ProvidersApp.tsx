import { useEffect, useMemo, useState } from "react";
import { Search, Plus, MessageSquare, Image } from "lucide-react";
import { AppShell } from "./shell";
import { ProviderIcon } from "../components/ProviderIcon";
import { AddAccountModal } from "../components/AddAccountModal";
import { KiroAddModal } from "../components/KiroAddModal";
import { providersApi, accountsApi, type Provider, type Account } from "../lib/api";

export function ProvidersApp() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<Provider | null>(null);

  async function load() {
    try {
      const [p, a] = await Promise.all([providersApi.list(), accountsApi.list()]);
      setProviders(p);
      setAccounts(a);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
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
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
        <Search className="h-4 w-4 text-white/30" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search providers..."
          className="w-full bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none"
        />
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[88px] animate-pulse rounded-2xl border border-white/5 bg-white/[0.02]" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-sm text-white/40">
          No providers match "{query}".
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {filtered.map((p) => (
            <ProviderCard
              key={p.name}
              provider={p}
              count={counts[p.name] ?? 0}
              onAdd={() => setAdding(p)}
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
      {adding && adding.name !== "kiro" && (
        <AddAccountModal
          provider={adding}
          onClose={() => setAdding(null)}
          onSaved={() => {
            setAdding(null);
            load();
          }}
        />
      )}
    </AppShell>
  );
}

function ProviderCard({
  provider,
  count,
  onAdd,
}: {
  provider: Provider;
  count: number;
  onAdd: () => void;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 transition-colors hover:bg-white/[0.06]">
      <div className="flex items-start gap-3">
        <ProviderIcon icon={provider.icon} label={provider.label} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{provider.label}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-white/40">
            {provider.chat && (
              <span className="inline-flex items-center gap-1 rounded-md bg-white/5 px-1.5 py-0.5">
                <MessageSquare className="h-3 w-3" /> chat
              </span>
            )}
            {provider.images && (
              <span className="inline-flex items-center gap-1 rounded-md bg-white/5 px-1.5 py-0.5">
                <Image className="h-3 w-3" /> images
              </span>
            )}
            <span className="rounded-md bg-white/5 px-1.5 py-0.5">
              {count} {count === 1 ? "account" : "accounts"}
            </span>
          </div>
        </div>
      </div>
      <button
        onClick={onAdd}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/10"
      >
        <Plus className="h-3.5 w-3.5" /> Add account
      </button>
    </div>
  );
}
