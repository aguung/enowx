import { useEffect, useRef, useState } from "react";
import { RefreshCw, CheckCircle2, XCircle, X, Trash2, Loader2 } from "lucide-react";
import { AppShell } from "./shell";
import { Tooltip } from "../components/Tooltip";
import { useDialog } from "../os/dialog";
import { onWarmup } from "../os/warmupBus";
import { warmupLogsApi, type WarmupLog } from "../lib/api";

const OUTCOME_TONE: Record<string, string> = {
  ok: "text-emerald-300 bg-emerald-500/10 ring-emerald-500/30",
  exhausted: "text-amber-300 bg-amber-500/10 ring-amber-500/30",
  dead: "text-red-300 bg-red-500/10 ring-red-500/30",
  transient: "text-white/60 bg-white/5 ring-white/15",
};

function tone(o: string) {
  return OUTCOME_TONE[o] ?? "text-white/60 bg-white/5 ring-white/15";
}

interface Pending {
  key: string;
  provider: string;
  label: string;
}

export function WarmupLogsApp() {
  const [logs, setLogs] = useState<WarmupLog[] | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<WarmupLog | null>(null);
  const [filter, setFilter] = useState("all");
  const dialog = useDialog();
  const alive = useRef(true);

  const providers = Array.from(new Set((logs ?? []).map((l) => l.provider))).sort();
  const shownLogs = (logs ?? []).filter((l) => filter === "all" || l.provider === filter);
  const shownPending = pending.filter((p) => filter === "all" || p.provider === filter);

  async function load() {
    try {
      const l = await warmupLogsApi.list();
      if (alive.current) {
        setLogs(l);
        setError("");
      }
    } catch (e) {
      if (alive.current) {
        setError(e instanceof Error ? e.message : "failed to load");
        setLogs([]);
      }
    }
  }

  // Poll so finished warmups appear without a manual refresh.
  useEffect(() => {
    alive.current = true;
    load();
    const id = setInterval(load, 2000);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, []);

  // Optimistic "warming up" cards driven by the warmup bus.
  useEffect(() => {
    return onWarmup((e) => {
      if (e.type === "start") {
        setPending((p) => [{ key: `${e.accountId}-${Date.now()}`, provider: e.provider, label: e.label }, ...p]);
      } else {
        // Clear one matching pending card and refresh from the server.
        setPending((p) => {
          const i = p.findIndex((x) => x.provider === e.provider && x.label === e.label);
          if (i === -1) return p;
          return [...p.slice(0, i), ...p.slice(i + 1)];
        });
        load();
      }
    });
  }, []);

  async function clear() {
    const ok = await dialog.confirm({
      title: "Clear warmup logs?",
      message: "All warmup history will be deleted. This cannot be undone.",
      confirmLabel: "Clear",
      danger: true,
    });
    if (!ok) return;
    try {
      await warmupLogsApi.clear();
      setLogs([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to clear");
    }
  }

  const empty = (logs?.length ?? 0) === 0 && pending.length === 0;
  const shownEmpty = shownLogs.length === 0 && shownPending.length === 0;

  return (
    <AppShell title="Warmup Logs" subtitle="Account warmup probe history">
      <div className="flex h-full flex-col">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex-1 text-[11px] text-white/40">{shownLogs.length} entries</span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            title="Filter by provider"
            className="h-8 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 text-xs text-white/80 focus:outline-none"
          >
            <option value="all" className="bg-[#15161c]">
              All providers
            </option>
            {providers.map((p) => (
              <option key={p} value={p} className="bg-[#15161c]">
                {p}
              </option>
            ))}
          </select>
          <Tooltip label="Reload logs" place="bottom">
            <button onClick={load} className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-white/50 hover:bg-white/10 hover:text-white">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip label="Clear all logs" place="bottom">
            <button
              onClick={clear}
              disabled={empty}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-white/50 hover:bg-red-500/30 hover:text-red-200 disabled:opacity-30"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>

        {error && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

        <div className="min-h-0 flex-1 overflow-auto">
          {logs === null ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl bg-white/5" />
              ))}
            </div>
          ) : shownEmpty ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-sm text-white/40">
              {empty ? "No warmups yet. Run one from Accounts." : "No warmups for this provider."}
            </div>
          ) : (
            <div className="space-y-2">
              {shownPending.map((p) => (
                <div key={p.key} className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-300" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-white">{p.label || `${p.provider} account`}</span>
                      <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-300 ring-1 ring-inset ring-amber-500/30">
                        warming up
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] capitalize text-white/40">{p.provider}</div>
                  </div>
                </div>
              ))}
              {shownLogs.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setOpen(l)}
                  className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left transition-colors hover:bg-white/[0.06]"
                >
                  {l.ok ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0 text-red-400" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-white">{l.label || `${l.provider} account`}</span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ring-1 ring-inset ${tone(l.outcome)}`}>
                        {l.outcome}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/40">
                      <span className="capitalize">{l.provider}</span>
                      <span className="text-white/20">·</span>
                      <span>{l.created_at}</span>
                      <span className="text-white/20">·</span>
                      <span>{l.duration_ms}ms</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {open && <RawModal log={open} onClose={() => setOpen(null)} />}
    </AppShell>
  );
}

function RawModal({ log, onClose }: { log: WarmupLog; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[85%] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#11131a] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{log.label || `${log.provider} account`}</p>
            <p className="font-mono text-[10px] text-white/35">
              {log.provider} · {log.outcome} → {log.status} · {log.duration_ms}ms · {log.created_at}
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
          <Section title="REQUEST" body={pretty(log.request)} />
          <Section title="RESPONSE" body={log.response || "(empty)"} />
          {log.usage && <Section title="USAGE" body={pretty(log.usage)} />}
        </div>
      </div>
    </div>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="mb-1 font-mono text-[10px] font-semibold tracking-widest text-emerald-400/70">{title}</p>
      <pre className="overflow-auto rounded-lg border border-white/10 bg-black/40 p-2.5 font-mono text-[11px] leading-relaxed text-white/75 whitespace-pre-wrap break-words">
        {body}
      </pre>
    </div>
  );
}

function pretty(s: string) {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}
