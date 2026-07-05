import { useEffect, useState, type ReactNode } from "react";
import {
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
  Globe,
  MessageCircle,
  BookOpen,
  ExternalLink,
  Users,
} from "lucide-react";
import {
  requestsApi,
  settingsApi,
  communityApi,
  type CommunityStats,
  type RequestSummary,
  type Settings,
  type SeriesPoint,
  type ModelStat,
  type ApiKey,
} from "../lib/api";
import { Sparkline } from "../components/Sparkline";
import { useKeys } from "./useKeys";
import { useDialog } from "./dialog";
import type { AppId } from "./types";
import { copyText } from "./clipboard";

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
  const [summary, setSummary] = useState<RequestSummary | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [models, setModels] = useState<ModelStat[]>([]);
  const [healthy, setHealthy] = useState(true);
  const [community, setCommunity] = useState<CommunityStats | null>(null);
  const { keys: keysData } = useKeys(); // shared store: stays in sync with the API Keys app
  const keys = keysData ?? [];

  useEffect(() => {
    let alive = true;
    const load = () => {
      requestsApi.summary().then((s) => alive && setSummary(s)).catch(() => {});
      requestsApi.series("all").then((s) => alive && setSeries(s ?? [])).catch(() => {});
      requestsApi.topModels().then((m) => alive && setModels(m ?? [])).catch(() => {});
      settingsApi.get().then((s) => alive && setSettings(s)).catch(() => {});
      fetch("/health").then((r) => alive && setHealthy(r.ok)).catch(() => alive && setHealthy(false));
      communityApi.stats().then((s) => alive && setCommunity(s)).catch(() => {});
    };
    load();
    const id = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    // @container: the widget grid responds to ITS OWN width, so it stays 1–2
    // columns in the narrow Classic board and fans out to 3–4 columns in the
    // full-width Focus board.
    <div className="pointer-events-auto h-full w-full @container">
      <div className="grid grid-cols-1 gap-4 @md:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4">
        <CommunityStatsWidget stats={community} onOpen={onOpen} />
        <ApiKeyWidget keys={keys} onOpen={onOpen} />
        <UsageWidget summary={summary} />
        <ThroughputWidget series={series} />
        <RequestsWidget summary={summary} onOpen={onOpen} />
        <TopModelsWidget models={models} onOpen={onOpen} />
        <EndpointsWidget />
        <GatewayWidget settings={settings} healthy={healthy} onOpen={onOpen} />
        <div className="@md:col-span-2 @4xl:col-span-3 @6xl:col-span-4">
          <CommunityWidget />
        </div>
      </div>
    </div>
  );
}

function CommunityWidget() {
  const links = [
    { icon: <Globe />, label: "Website", sub: "enowxlabs.com", href: "https://enowxlabs.com" },
    { icon: <MessageCircle />, label: "Discord", sub: "Join the community", href: "https://discord.gg/enowxlabs" },
    { icon: <BookOpen />, label: "GitHub", sub: "enowdev/enowx", href: "https://github.com/enowdev/enowx" },
  ];
  return (
    <div className="glass flex flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-xl">
      <div className="mb-3 flex items-center gap-2 text-white/70">
        <span className="[&>svg]:h-4 [&>svg]:w-4">
          <Globe />
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide">Community &amp; links</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {links.map((l) => (
          <a
            key={l.label}
            href={l.href}
            target="_blank"
            rel="noreferrer"
            className="group flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 transition-colors hover:bg-white/[0.07]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-white/80 [&>svg]:h-4 [&>svg]:w-4">
              {l.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 text-sm font-medium text-white">
                {l.label}
                <ExternalLink className="h-3 w-3 text-white/30 transition-colors group-hover:text-white/60" />
              </span>
              <span className="block truncate text-[11px] text-white/40">{l.sub}</span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

// Widget is a card container. It is a <div> (not a <button>) so interactive
// children — create/copy/delete buttons — work; only the header acts as the
// "open app" affordance when onOpen is provided.
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
    <div className="glass flex flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left shadow-xl">
      <div
        onClick={onOpen}
        className={`mb-3 flex items-center gap-2 text-white/70 ${onOpen ? "cursor-pointer hover:text-white" : ""}`}
      >
        <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wide">{title}</span>
      </div>
      {children}
    </div>
  );
}

// compactNum shortens a count: 1000→1k, 12300→12.3k, 2000000→2M.
function compactNum(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return (k < 10 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)) + "k";
  }
  const m = n / 1_000_000;
  return (m < 10 ? m.toFixed(1).replace(/\.0$/, "") : Math.round(m)) + "M";
}

function CommunityStatsWidget({ stats, onOpen }: { stats: CommunityStats | null; onOpen: (id: AppId) => void }) {
  return (
    <Widget icon={<Users />} title="Community" onOpen={() => onOpen("chat")}>
      {stats === null ? (
        <Loading />
      ) : (
        <div className="flex items-stretch gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-2xl font-semibold tabular-nums text-white">{compactNum(stats.total_users)}</div>
            <div className="mt-0.5 text-[11px] text-white/40">Total users</div>
          </div>
          <div className="w-px shrink-0 bg-white/10" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <span className="h-1.5 w-1.5 shrink-0 self-center rounded-full bg-emerald-400" />
              <span className="text-2xl font-semibold tabular-nums text-emerald-300">{compactNum(stats.online_users)}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-white/40">Online now</div>
          </div>
        </div>
      )}
    </Widget>
  );
}

function ApiKeyWidget({ keys, onOpen }: { keys: ApiKey[]; onOpen: (id: AppId) => void }) {
  const { add } = useKeys();
  const dialog = useDialog();

  const create = async () => {
    const v = await dialog.form({
      title: "New API key",
      fields: [
        { name: "label", label: "Label" },
        { name: "token_limit", label: "Token limit (0 = unlimited)", type: "number", placeholder: "0" },
        { name: "max_concurrent", label: "Max concurrent (0 = unlimited)", type: "number", placeholder: "0" },
        { name: "expires_in_days", label: "Expires in days (0 = never)", type: "number", placeholder: "0" },
      ],
      confirmLabel: "Create key",
    });
    if (!v) return;
    await add({
      label: v.label?.trim() || undefined,
      token_limit: Number(v.token_limit) || 0,
      max_concurrent: Number(v.max_concurrent) || 0,
      expires_in_days: Number(v.expires_in_days) || 0,
    });
  };

  if (keys.length === 0) {
    return (
      <Widget icon={<KeyRound />} title="API key">
        <p className="mb-3 text-sm text-white/40">No gateway key. Create one to require auth on /v1 and /anthropic.</p>
        <button
          type="button"
          onClick={create}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10"
        >
          <Plus className="h-3.5 w-3.5" /> Create API key
        </button>
      </Widget>
    );
  }

  return (
    <Widget icon={<KeyRound />} title="API key" onOpen={() => onOpen("api-keys")}>
      <div className="space-y-2">
        {keys.slice(0, 1).map((k) => (
          <KeyRow key={k.id} apiKey={k} />
        ))}
      </div>
      <button
        type="button"
        onClick={create}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10"
      >
        <Plus className="h-3.5 w-3.5" /> New key
      </button>
    </Widget>
  );
}

function KeyRow({ apiKey }: { apiKey: ApiKey }) {
  const { remove } = useKeys();
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
            copyText(apiKey.secret);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            void remove(apiKey.id);
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
    <Widget icon={<Activity />} title="Throughput">
      <Sparkline values={values} />
      <div className="mt-2 text-[11px] text-white/40">{fmt(total)} requests total</div>
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
    <Widget icon={<Activity />} title="Requests" onOpen={() => onOpen("requests")}>
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

function EndpointsWidget() {
  const base = `${window.location.origin}/v1`;
  const anthropic = `${window.location.origin}/anthropic`;
  return (
    <Widget icon={<Plug />} title="Endpoints">
      <div className="space-y-2">
        <CopyRow label="OpenAI base URL" value={base} />
        <CopyRow label="Anthropic base URL" value={anthropic} />
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
        copyText(value);
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
