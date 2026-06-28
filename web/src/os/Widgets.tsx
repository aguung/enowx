import { useEffect, useState, type ReactNode } from "react";
import {
  Boxes,
  Activity,
  Plug,
  Server,
  Copy,
  Check,
  CircleDot,
  BarChart3,
  KeyRound,
  Trophy,
  Plus,
  Trash2,
} from "lucide-react";
import {
  accountsApi,
  requestsApi,
  settingsApi,
  keysApi,
  type Account,
  type RequestSummary,
  type Settings,
  type SeriesPoint,
  type ModelStat,
  type ApiKey,
} from "../lib/api";
import { Sparkline } from "../components/Sparkline";
import type { AppId } from "./types";

const fmt = (n: number) => new Intl.NumberFormat().format(n);

function compact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function uptime(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

export function Widgets({ onOpen }: { onOpen: (id: AppId) => void }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [summary, setSummary] = useState<RequestSummary | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [models, setModels] = useState<ModelStat[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [healthy, setHealthy] = useState(true);

  const reloadKeys = () => keysApi.list().then((k) => setKeys(k ?? [])).catch(() => {});

  useEffect(() => {
    let alive = true;
    const load = () => {
      accountsApi.list().then((a) => alive && setAccounts(a ?? [])).catch(() => alive && setAccounts([]));
      requestsApi.summary().then((s) => alive && setSummary(s)).catch(() => {});
      requestsApi.series().then((s) => alive && setSeries(s ?? [])).catch(() => {});
      requestsApi.topModels().then((m) => alive && setModels(m ?? [])).catch(() => {});
      settingsApi.get().then((s) => alive && setSettings(s)).catch(() => {});
      keysApi.list().then((k) => alive && setKeys(k ?? [])).catch(() => {});
      fetch("/health").then((r) => alive && setHealthy(r.ok)).catch(() => alive && setHealthy(false));
    };
    load();
    const id = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="pointer-events-auto h-full w-full overflow-auto px-5 py-5">
      <div className="mx-auto grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
        <PoolWidget accounts={accounts} onOpen={onOpen} />
        <ApiKeyWidget keys={keys} onChanged={reloadKeys} onOpen={onOpen} />
        <UsageWidget summary={summary} />
        <ThroughputWidget series={series} />
        <RequestsWidget summary={summary} onOpen={onOpen} />
        <TopModelsWidget models={models} onOpen={onOpen} />
        <EndpointsWidget hasKey={keys.length > 0} sampleKey={keys[0]?.secret} />
        <GatewayWidget settings={settings} healthy={healthy} onOpen={onOpen} />
      </div>
    </div>
  );
}

function Widget({
  icon,
  title,
  onOpen,
  children,
}: {
  icon: ReactNode;
  title: string;
  onOpen?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onOpen}
      disabled={!onOpen}
      className={`glass flex flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left shadow-xl transition-colors ${
        onOpen ? "hover:bg-white/[0.07]" : "cursor-default"
      }`}
    >
      <div className="mb-3 flex items-center gap-2 text-white/70">
        <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wide">{title}</span>
      </div>
      {children}
    </button>
  );
}

function statusTone(status: string) {
  switch (status) {
    case "active":
      return "text-emerald-300";
    case "exhausted":
      return "text-amber-300";
    case "banned":
      return "text-red-300";
    default:
      return "text-white/50";
  }
}

function PoolWidget({ accounts, onOpen }: { accounts: Account[] | null; onOpen: (id: AppId) => void }) {
  const byProvider: Record<string, Record<string, number>> = {};
  let total = 0;
  let active = 0;
  for (const a of accounts ?? []) {
    byProvider[a.provider] ??= {};
    byProvider[a.provider][a.status] = (byProvider[a.provider][a.status] ?? 0) + 1;
    total++;
    if (a.status === "active") active++;
  }
  const providers = Object.keys(byProvider);

  return (
    <Widget icon={<Boxes />} title="Pool health" onOpen={() => onOpen("accounts")}>
      {accounts === null ? (
        <Loading />
      ) : total === 0 ? (
        <p className="text-sm text-white/40">No accounts yet. Add one in Providers.</p>
      ) : (
        <>
          <div className="space-y-1.5">
            {providers.map((p) => (
              <div key={p} className="flex items-center justify-between text-xs">
                <span className="text-white/70">{p}</span>
                <span className="flex gap-2 tabular-nums">
                  {Object.entries(byProvider[p]).map(([st, n]) => (
                    <span key={st} className={statusTone(st)}>
                      {n} {st}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 border-t border-white/10 pt-2 text-[11px] text-white/40">
            {total} accounts · {active} active
          </div>
        </>
      )}
    </Widget>
  );
}

function ApiKeyWidget({
  keys,
  onChanged,
  onOpen,
}: {
  keys: ApiKey[];
  onChanged: () => void;
  onOpen: (id: AppId) => void;
}) {
  const [creating, setCreating] = useState(false);

  const create = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setCreating(true);
    try {
      await keysApi.add();
      onChanged();
    } finally {
      setCreating(false);
    }
  };

  if (keys.length === 0) {
    // No key yet: prompt to create one (the "only visible once a key exists"
    // detail is the populated state below).
    return (
      <Widget icon={<KeyRound />} title="API key">
        <p className="mb-3 text-sm text-white/40">
          No gateway key. Create one to require auth on /v1 and /anthropic.
        </p>
        <div
          onClick={create}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10"
        >
          <Plus className="h-3.5 w-3.5" /> {creating ? "Creating..." : "Create API key"}
        </div>
      </Widget>
    );
  }

  return (
    <Widget icon={<KeyRound />} title="API key" onOpen={() => onOpen("settings")}>
      <div className="space-y-2">
        {keys.slice(0, 2).map((k) => (
          <KeyRow key={k.id} apiKey={k} onChanged={onChanged} />
        ))}
      </div>
      <div
        onClick={create}
        className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10"
      >
        <Plus className="h-3.5 w-3.5" /> {creating ? "Creating..." : "New key"}
      </div>
    </Widget>
  );
}

function KeyRow({ apiKey, onChanged }: { apiKey: ApiKey; onChanged: () => void }) {
  const [copied, setCopied] = useState(false);
  const masked = `${apiKey.secret.slice(0, 8)}…${apiKey.secret.slice(-4)}`;

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">
      <div className="min-w-0">
        {apiKey.label && <p className="truncate text-[10px] text-white/40">{apiKey.label}</p>}
        <p className="truncate font-mono text-xs text-white/80">{masked}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigator.clipboard?.writeText(apiKey.secret);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={async (e) => {
            e.stopPropagation();
            await keysApi.remove(apiKey.id);
            onChanged();
          }}
          className="rounded p-1 text-white/40 hover:bg-red-500/30 hover:text-red-200"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function UsageWidget({ summary }: { summary: RequestSummary | null }) {
  return (
    <Widget icon={<BarChart3 />} title="Usage statistics">
      {summary === null ? (
        <Loading />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Tokens in" value={compact(summary.in_tokens)} />
          <Stat label="Tokens out" value={compact(summary.out_tokens)} />
          <Stat label="Requests" value={fmt(summary.total)} />
          <Stat label="Avg latency" value={`${summary.avg_ms}ms`} />
        </div>
      )}
    </Widget>
  );
}

function ThroughputWidget({ series }: { series: SeriesPoint[] }) {
  const values = series.map((p) => p.requests);
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <Widget icon={<Activity />} title="Throughput (24h)">
      <Sparkline values={values} />
      <div className="mt-2 text-[11px] text-white/40">{fmt(total)} requests over 24h</div>
    </Widget>
  );
}

function RequestsWidget({
  summary,
  onOpen,
}: {
  summary: RequestSummary | null;
  onOpen: (id: AppId) => void;
}) {
  const okRate = summary && summary.total > 0 ? Math.round((summary.ok / summary.total) * 100) : 0;
  return (
    <Widget icon={<Activity />} title="Requests today" onOpen={() => onOpen("requests")}>
      {summary === null ? (
        <Loading />
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums text-white">{fmt(summary.total)}</span>
            <span className="text-xs text-white/50">requests</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Mini label="OK" value={`${okRate}%`} tone="text-emerald-300" />
            <Mini label="Errors" value={fmt(summary.errors)} tone={summary.errors ? "text-red-300" : "text-white/70"} />
            <Mini label="Avg" value={`${summary.avg_ms}ms`} />
          </div>
        </>
      )}
    </Widget>
  );
}

function TopModelsWidget({ models, onOpen }: { models: ModelStat[]; onOpen: (id: AppId) => void }) {
  return (
    <Widget icon={<Trophy />} title="Top models" onOpen={() => onOpen("requests")}>
      {models.length === 0 ? (
        <p className="text-sm text-white/40">No requests yet today.</p>
      ) : (
        <div className="space-y-1.5">
          {models.map((m) => (
            <div key={m.model} className="flex items-center justify-between text-xs">
              <span className="truncate text-white/70">{m.model}</span>
              <span className="ml-2 shrink-0 tabular-nums text-white/50">{fmt(m.requests)} req</span>
            </div>
          ))}
        </div>
      )}
    </Widget>
  );
}

function EndpointsWidget({ hasKey, sampleKey }: { hasKey: boolean; sampleKey?: string }) {
  const base = `${window.location.origin}/v1`;
  const anthropic = `${window.location.origin}/anthropic`;
  return (
    <Widget icon={<Plug />} title="Endpoints">
      <div className="space-y-2">
        <CopyRow label="OpenAI base URL" value={base} />
        <CopyRow label="Anthropic base URL" value={anthropic} />
        {hasKey && sampleKey && <CopyRow label="Auth header" value={`Authorization: Bearer ${sampleKey}`} />}
      </div>
    </Widget>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="group flex cursor-pointer items-center justify-between rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5"
    >
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-white/40">{label}</p>
        <p className="truncate font-mono text-xs text-white/80">{value}</p>
      </div>
      <span className="ml-2 shrink-0 text-white/40 group-hover:text-white/70">
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
      </span>
    </div>
  );
}

function GatewayWidget({
  settings,
  healthy,
  onOpen,
}: {
  settings: Settings | null;
  healthy: boolean;
  onOpen: (id: AppId) => void;
}) {
  return (
    <Widget icon={<Server />} title="Gateway" onOpen={() => onOpen("settings")}>
      <div className="flex items-center gap-2">
        <span className="text-lg font-bold text-white">enx {settings?.version ?? "—"}</span>
        <span className={`flex items-center gap-1 text-xs ${healthy ? "text-emerald-300" : "text-red-300"}`}>
          <CircleDot className="h-3 w-3" /> {healthy ? "healthy" : "down"}
        </span>
      </div>
      <div className="mt-3 space-y-1 text-xs text-white/60">
        <Line k="Port" v={settings ? String(settings.port) : "—"} />
        <Line k="Uptime" v={settings ? uptime(settings.uptime_sec) : "—"} />
        <Line k="Runtime" v={settings?.runtime_dir ?? "—"} mono />
      </div>
    </Widget>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-black/20 p-2">
      <p className="text-base font-bold tabular-nums text-white">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-white/40">{label}</p>
    </div>
  );
}

function Mini({ label, value, tone = "text-white/80" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-black/20 py-1.5">
      <p className={`text-sm font-semibold tabular-nums ${tone}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-white/40">{label}</p>
    </div>
  );
}

function Line({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-white/40">{k}</span>
      <span className={`truncate ${mono ? "font-mono" : ""} text-white/70`}>{v}</span>
    </div>
  );
}

function Loading() {
  return <div className="h-12 animate-pulse rounded-lg bg-white/5" />;
}
