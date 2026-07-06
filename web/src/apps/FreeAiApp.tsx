import { useEffect, useRef, useState } from "react";
import { Loader2, Gift, Trash2, Plus, X, Check, Sparkles } from "lucide-react";
import { AppShell } from "./shell";
import { useProfile } from "../os/useProfile";
import { freeAiApi, type DonatedAccount } from "../lib/api";

// Provider templates: pre-fill the endpoint so donors only paste key + model.
const TEMPLATES: { id: string; label: string; endpoint: string }[] = [
  { id: "openrouter", label: "OpenRouter", endpoint: "https://openrouter.ai/api/v1" },
  { id: "custom", label: "Custom (any OpenAI-compatible)", endpoint: "" },
];

// FreeAiApp lets users donate an AI account to the community Free AI pool. The
// cloud health-checks the credentials before accepting; donors can withdraw any
// time. Serving from the pool (spending Kleos) is a separate feature.
export function FreeAiApp() {
  const profile = useProfile();
  const [items, setItems] = useState<DonatedAccount[] | null>(null);
  const [adding, setAdding] = useState(false);

  const load = () => freeAiApi.donations().then((r) => setItems(r.items ?? [])).catch(() => setItems([]));
  useEffect(() => { if (profile.loggedIn) load(); }, [profile.loggedIn]);

  if (!profile.loggedIn) {
    return (
      <AppShell title="Free AI" subtitle="Donate an AI account to the community pool">
        <div className="flex h-40 items-center justify-center text-sm text-white/55">Sign in to donate.</div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Free AI" subtitle="Donate an AI account to the community pool">
      <div className="flex h-full flex-col gap-3">
        <div className="rounded-xl border border-indigo-400/15 bg-indigo-400/[0.04] px-3 py-2.5 text-[11px] text-white/60">
          Donate an AI account and everyone can use it for free (paid with Kleos). Your credentials are
          health-checked, stored encrypted, used only to serve requests — and you can withdraw any time.
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-white/70">Your donations {items ? `(${items.length})` : ""}</span>
          <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black hover:opacity-90">
            <Plus className="h-3.5 w-3.5" /> Donate account
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {items === null ? (
            <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-white/30" /></div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center text-xs text-white/40">
              You haven't donated any accounts yet.
            </div>
          ) : (
            <div className="space-y-1.5">
              {items.map((it) => <DonationRow key={it.id} item={it} onGone={load} />)}
            </div>
          )}
        </div>
      </div>

      {adding && <DonateModal onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />}
    </AppShell>
  );
}

function DonationRow({ item, onGone }: { item: DonatedAccount; onGone: () => void }) {
  const [busy, setBusy] = useState(false);
  const statusColor = item.status === "active" ? "text-emerald-300" : item.status === "dead" ? "text-red-300" : "text-amber-300";
  const withdraw = async () => {
    setBusy(true);
    await freeAiApi.withdraw(item.id).catch(() => {});
    onGone();
  };
  const models = item.models ?? [];
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs">
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-indigo-300" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-white">{item.label || item.provider}</div>
        <div className="truncate text-[10px] text-white/40">
          {item.provider} · {models.length} model{models.length === 1 ? "" : "s"}
          {models.length > 0 && <span className="text-white/30"> · {models.slice(0, 3).join(", ")}{models.length > 3 ? "…" : ""}</span>}
        </div>
      </div>
      <span className={`text-[10px] ${statusColor}`}>{item.status}</span>
      <button onClick={withdraw} disabled={busy} className="text-white/30 hover:text-red-300" title="Withdraw from pool">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

// parseModels splits a comma/newline-separated model list, trimmed + de-duped.
function parseModels(s: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of s.split(/[\n,]/).map((x) => x.trim())) {
    if (m && !seen.has(m)) { seen.add(m); out.push(m); }
  }
  return out;
}

function DonateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [tpl, setTpl] = useState(TEMPLATES[0]);
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelsText, setModelsText] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [err, setErr] = useState("");
  const keyRef = useRef<HTMLInputElement>(null);

  const pickTemplate = (t: typeof TEMPLATES[number]) => { setTpl(t); setEndpoint(t.endpoint); };
  const ep = () => (tpl.id === "custom" ? endpoint : tpl.endpoint).trim();
  const models = parseModels(modelsText);

  const fetchModels = async () => {
    if (!ep() || !apiKey.trim()) { setErr("Enter the endpoint + API key first."); return; }
    setFetching(true); setErr("");
    try {
      const r = await freeAiApi.fetchModels({ endpoint: ep(), api_key: apiKey.trim() });
      if (!r.ok || !r.models?.length) { setErr(r.reason || "Couldn't fetch models — add them manually."); return; }
      setModelsText(r.models.join("\n"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "fetch failed");
    } finally { setFetching(false); }
  };

  const submit = async () => {
    if (!ep() || !apiKey.trim() || models.length === 0 || busy) return;
    setBusy(true); setErr("");
    try {
      const r = await freeAiApi.donate({
        provider: tpl.id,
        label: label.trim(),
        creds: { endpoint: ep(), api_key: apiKey.trim() },
        models,
      });
      if (!r.ok) { setErr(r.reason || "Account rejected."); return; }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "donation failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[10600] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#0e1016] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Gift className="h-4 w-4 text-indigo-300" /> Donate an AI account</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 p-4">
          <p className="text-[11px] text-white/40">One account can serve many models. Fetch the model list automatically, or add them yourself. We verify the account works before adding it to the pool.</p>
          <div>
            <label className="mb-1 block text-[11px] text-white/50">Provider</label>
            <select
              value={tpl.id}
              onChange={(e) => pickTemplate(TEMPLATES.find((t) => t.id === e.target.value) || TEMPLATES[0])}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-white/25"
            >
              {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          {tpl.id === "custom" && (
            <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="Endpoint (https://…/v1)" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-white/25" />
          )}
          <input ref={keyRef} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API key" type="password" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white outline-none focus:border-white/25" />

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[11px] text-white/50">Models {models.length > 0 && <span className="text-white/30">({models.length})</span>}</label>
              <button onClick={fetchModels} disabled={fetching || !ep() || !apiKey.trim()} className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-0.5 text-[10px] text-white/60 hover:bg-white/5 disabled:opacity-40">
                {fetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Fetch from endpoint
              </button>
            </div>
            <textarea value={modelsText} onChange={(e) => setModelsText(e.target.value)} placeholder="One model per line (or comma-separated), e.g.&#10;gpt-4o-mini&#10;gpt-4o" rows={4} className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-[11px] text-white outline-none focus:border-white/25" />
          </div>

          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-white/25" />
          {err && <p className="text-[11px] text-red-300">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-white/50 hover:bg-white/5">Cancel</button>
            <button onClick={submit} disabled={busy || !apiKey.trim() || models.length === 0} className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black hover:opacity-90 disabled:opacity-40">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {busy ? "Checking…" : "Donate"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
