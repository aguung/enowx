import { useEffect, useState } from "react";
import { AppShell } from "./shell";
import { docsApi, type Docs, type DocEndpoint } from "../lib/api";

const METHOD_TONE: Record<string, string> = {
  GET: "text-sky-300 bg-sky-500/10 ring-sky-500/30",
  POST: "text-emerald-300 bg-emerald-500/10 ring-emerald-500/30",
  PATCH: "text-amber-300 bg-amber-500/10 ring-amber-500/30",
  DELETE: "text-red-300 bg-red-500/10 ring-red-500/30",
};

function methodTone(m: string) {
  return METHOD_TONE[m] ?? "text-white/60 bg-white/5 ring-white/15";
}

export function DocsApp() {
  const [docs, setDocs] = useState<Docs | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    docsApi
      .get()
      .then(setDocs)
      .catch((e) => setError(e instanceof Error ? e.message : "failed to load"));
  }, []);

  return (
    <AppShell title="Docs" subtitle="API reference for integrations & plugins">
      {error && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
      {!docs ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-white/5" />
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          <Overview docs={docs} />
          <Plugins docs={docs} />
          {docs.groups.map((g) => (
            <section key={g.name}>
              <h2 className="text-sm font-semibold text-white">{g.name}</h2>
              <p className="mb-2 text-[11px] text-white/40">{g.desc}</p>
              <div className="space-y-2">
                {g.endpoints.map((e) => (
                  <Endpoint key={e.method + e.path} e={e} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function Overview({ docs }: { docs: Docs }) {
  const o = docs.overview;
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-white">{o.name}</h2>
        <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-white/50">v{docs.version}</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-white/55">{o.summary}</p>
      <div className="mt-2.5 space-y-1 text-[11px] text-white/50">
        <Line k="Base URL" v={o.base_url} mono />
        <Line k="OpenAI" v={o.openai_base} mono />
        <Line k="Anthropic" v={o.anthropic_base} mono />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-white/40">{o.auth}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-white/40">{o.envelope}</p>
    </section>
  );
}

function Plugins({ docs }: { docs: Docs }) {
  return (
    <section className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.04] p-3.5">
      <h2 className="text-sm font-semibold text-emerald-200">Plugins</h2>
      <p className="mt-1 text-xs leading-relaxed text-white/55">{docs.plugins.summary}</p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-white/40">{docs.plugins.discovery}</p>
    </section>
  );
}

function Endpoint({ e }: { e: DocEndpoint }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center gap-2">
        <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ring-1 ring-inset ${methodTone(e.method)}`}>
          {e.method}
        </span>
        <span className="truncate font-mono text-xs text-white/85">{e.path}</span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-white/50">{e.desc}</p>
      {e.params && e.params.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {e.params.map((p) => (
            <div key={p.in + p.name} className="flex items-baseline gap-2 text-[10px]">
              <span className="font-mono text-white/70">{p.name}</span>
              <span className="rounded bg-white/5 px-1 py-px text-white/35">{p.in}</span>
              <span className="text-white/40">{p.desc}</span>
            </div>
          ))}
        </div>
      )}
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
