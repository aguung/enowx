import { useEffect, useMemo, useState } from "react";
import { usePersisted } from "../os/usePersisted";
import { AppShell } from "./shell";
import { TermGauge, TermBarRow } from "../components/term/TermChart";
import { AreaChart, type ChartPoint } from "../components/term/AreaChart";
import {
  requestsApi,
  type RequestSummary,
  type SeriesPoint,
  type ModelStat,
  type SeriesRange,
} from "../lib/api";

const RANGES: { id: SeriesRange; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
  { id: "all", label: "All time" },
];

const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);

// daily buckets are "YYYY-MM-DD HH:00" -> show HH:00; others "YYYY-MM-DD" -> MM-DD.
function axisLabel(bucket: string, range: SeriesRange): string {
  if (range === "daily") return bucket.slice(11, 16);
  return bucket.slice(5); // MM-DD
}

export function StatisticsApp() {
  const [range, setRange] = usePersisted<SeriesRange>("stats-range", "daily");
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [summary, setSummary] = useState<RequestSummary | null>(null);
  const [models, setModels] = useState<ModelStat[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      requestsApi.series(range).then((s) => alive && setSeries(s ?? [])).catch(() => alive && setSeries([]));
      requestsApi.summary().then((s) => alive && setSummary(s)).catch(() => {});
      requestsApi.topModels(8).then((m) => alive && setModels(m ?? [])).catch(() => {});
    };
    load();
    const id = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [range]);

  const reqPoints: ChartPoint[] = useMemo(
    () => series.map((p) => ({ label: axisLabel(p.bucket, range), value: p.requests })),
    [series, range],
  );
  const tokPoints: ChartPoint[] = useMemo(
    () => series.map((p) => ({ label: axisLabel(p.bucket, range), value: p.in_tokens + p.out_tokens })),
    [series, range],
  );

  const totalReq = series.reduce((a, p) => a + p.requests, 0);
  const totalTok = series.reduce((a, p) => a + p.in_tokens + p.out_tokens, 0);
  const okRate = summary && summary.total > 0 ? Math.round((summary.ok / summary.total) * 100) : 0;
  const errRate = summary && summary.total > 0 ? Math.round((summary.errors / summary.total) * 100) : 0;
  const latPct = summary ? Math.min(100, Math.round((summary.avg_ms / 2000) * 100)) : 0;
  const maxModel = Math.max(...models.map((m) => m.requests), 1);

  return (
    <AppShell title="Statistics" subtitle="Usage over time">
      <div className="space-y-3">
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={`rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors ${
                range === r.id
                  ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
                  : "text-white/50 hover:bg-white/5 hover:text-white/80"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <Panel title="REQUESTS" hint={`${compact(totalReq)} total`}>
          <div className="h-52">
            {series.length === 0 ? <Flat /> : <AreaChart points={reqPoints} unit="requests" />}
          </div>
        </Panel>

        <Panel title="TOKENS (IN+OUT)" hint={`${compact(totalTok)} total`}>
          <div className="h-52">
            {series.length === 0 ? <Flat /> : <AreaChart points={tokPoints} unit="tokens" />}
          </div>
        </Panel>

        <Panel title="HEALTH (TODAY)">
          <div className="space-y-1.5">
            <TermGauge label="success" percent={okRate} tone="text-emerald-400" />
            <TermGauge label="errors" percent={errRate} tone="text-red-400" />
            <TermGauge label="latency" percent={latPct} tone={latPct > 60 ? "text-amber-400" : "text-emerald-400"} />
            <p className="pt-1 font-mono text-[11px] text-white/40">
              avg {summary?.avg_ms ?? 0}ms · {summary?.total ?? 0} req today
            </p>
          </div>
        </Panel>

        <Panel title="TOP MODELS (TODAY)">
          {models.length === 0 ? (
            <p className="font-mono text-[11px] text-white/40">no requests yet today</p>
          ) : (
            <div className="space-y-1">
              {models.map((m) => (
                <TermBarRow key={m.model} label={m.model} value={m.requests} max={maxModel} suffix={`${m.requests} req`} />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-emerald-500/15 bg-black/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] font-semibold tracking-widest text-emerald-400/80">{title}</span>
        {hint && <span className="font-mono text-[10px] text-white/35">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

// Flat baseline when there is no data: a green line at zero, still "running".
function Flat() {
  return (
    <AreaChart
      points={[
        { label: "", value: 0 },
        { label: "", value: 0 },
      ]}
      unit=""
    />
  );
}
