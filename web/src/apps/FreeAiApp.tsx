import { useEffect, useRef, useState } from "react";
import { Loader2, Gift, Trash2, Plus, X, Check, Sparkles, Copy, Eye, EyeOff } from "lucide-react";
import { AppShell } from "./shell";
import { useProfile } from "../os/useProfile";
import { copyText } from "../os/clipboard";
import { freeAiApi, accountsApi, keysApi, type DonatedAccount, type FreeAiModel } from "../lib/api";

// CopyBtn is a small inline copy button that flips to a check for a moment.
function CopyBtn({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); copyText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
      className="shrink-0 rounded p-1 text-white/40 hover:bg-white/10 hover:text-white/80"
      title={title}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-300" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// EndpointBox shows how to call Free AI: the endpoint + the user's actual API
// key to authenticate with (or a button to create one if they have none).
function EndpointBox() {
  const url = `${location.origin}/api/ai/v1/chat/completions`;
  const [keys, setKeys] = useState<{ id: number; secret?: string }[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [reveal, setReveal] = useState(false);

  const loadKeys = () => keysApi.list().then((ks) => setKeys(ks ?? [])).catch(() => setKeys([]));
  useEffect(() => { loadKeys(); }, []);

  const createKey = async () => {
    setCreating(true);
    try { await keysApi.add({ label: "Free AI" }); await loadKeys(); setReveal(true); }
    finally { setCreating(false); }
  };

  const key = keys?.find((k) => k.secret)?.secret ?? "";
  const masked = key ? key.slice(0, 8) + "…" + key.slice(-4) : "";

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[11px]">
      <div className="mb-1.5 font-medium text-white/70">How to use</div>
      <p className="mb-2 text-white/45">OpenAI-compatible. POST a chat completion to this endpoint with your gateway API key as the Bearer token. You're charged Kleos per request based on the model.</p>
      <div className="flex items-center gap-2 rounded-lg bg-black/30 px-2.5 py-1.5">
        <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-emerald-300">POST</span>
        <code className="flex-1 truncate font-mono text-white/80">{url}</code>
        <CopyBtn text={url} title="Copy endpoint" />
      </div>

      <div className="mt-2 mb-1 text-white/50">Your API key</div>
      {keys === null ? (
        <div className="flex h-8 items-center px-1"><Loader2 className="h-3.5 w-3.5 animate-spin text-white/30" /></div>
      ) : key ? (
        <div className="flex items-center gap-2 rounded-lg bg-black/30 px-2.5 py-1.5">
          <code className="flex-1 truncate font-mono text-white/80">{reveal ? key : masked}</code>
          <button onClick={() => setReveal((v) => !v)} className="shrink-0 rounded p-1 text-white/40 hover:bg-white/10 hover:text-white/80" title={reveal ? "Hide" : "Reveal"}>
            {reveal ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </button>
          <CopyBtn text={key} title="Copy API key" />
        </div>
      ) : (
        <button onClick={createKey} disabled={creating} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white/75 hover:bg-white/10 disabled:opacity-40">
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Create an API key for Free AI
        </button>
      )}
      <p className="mt-1 text-[10px] text-white/30">Send it as <code className="text-white/45">Authorization: Bearer &lt;key&gt;</code>. Manage keys in the API keys app.</p>
    </div>
  );
}

// ModelRow shows one available model: id + copy + clear input/output Kleos price.
function ModelRow({ m }: { m: FreeAiModel }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs hover:bg-white/5">
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-indigo-300" />
      <span className="flex-1 truncate font-mono text-white/85" title={m.id}>{m.id}</span>
      <CopyBtn text={m.id} title="Copy model id" />
      <div className="flex shrink-0 items-center gap-2 text-[10px]">
        <span className="rounded bg-white/5 px-1.5 py-0.5 text-white/45" title="Kleos per 1M input tokens">in {m.kleos_per_1m_in.toLocaleString()}</span>
        <span className="rounded bg-white/5 px-1.5 py-0.5 text-white/45" title="Kleos per 1M output tokens">out {m.kleos_per_1m_out.toLocaleString()}</span>
        <span className="text-white/25">Kleos/1M</span>
      </div>
    </div>
  );
}

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
  const [tab, setTab] = useState<"browse" | "donate">("browse");
  const [items, setItems] = useState<DonatedAccount[] | null>(null);
  const [models, setModels] = useState<FreeAiModel[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");

  const load = () => {
    freeAiApi.donations().then((r) => setItems(r.items ?? [])).catch(() => setItems([]));
    freeAiApi.models().then((r) => setModels(r.data ?? [])).catch(() => setModels([]));
  };
  useEffect(() => { if (profile.loggedIn) load(); }, [profile.loggedIn]);

  if (!profile.loggedIn) {
    return (
      <AppShell title="Free AI" subtitle="Community AI pool, paid with Kleos">
        <div className="flex h-40 items-center justify-center text-sm text-white/55">Sign in to use Free AI.</div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Free AI" subtitle="Community AI pool, paid with Kleos">
      <div className="flex h-full flex-col gap-3">
        {/* Two pages: Browse available models · Donate + manage your donations. */}
        <div className="flex rounded-lg border border-white/10 bg-white/[0.02] p-0.5 text-xs">
          <button onClick={() => setTab("browse")} className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-medium ${tab === "browse" ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"}`}>
            <Sparkles className="h-3.5 w-3.5" /> Browse models
          </button>
          <button onClick={() => setTab("donate")} className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-medium ${tab === "donate" ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"}`}>
            <Gift className="h-3.5 w-3.5" /> Donate {items && items.length > 0 ? `(${items.length})` : ""}
          </button>
        </div>

        {tab === "browse" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-white/70">Available now {models ? `(${models.length})` : ""}</span>
              {models && models.length > 6 && (
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models…" className="w-40 rounded-md border border-white/10 bg-black/25 px-2 py-1 text-[11px] text-white/80 outline-none focus:border-white/25" />
              )}
            </div>
            <EndpointBox />
            <div className="min-h-0 flex-1 overflow-auto">
              {models === null ? (
                <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-white/30" /></div>
              ) : models.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center text-xs text-white/40">
                  No models available yet — the pool is empty. Donate an account to add some.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {models.filter((m) => !q || m.id.toLowerCase().includes(q.toLowerCase())).map((m) => (
                    <ModelRow key={m.id} m={m} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="rounded-xl border border-indigo-400/15 bg-indigo-400/[0.04] px-3 py-2.5 text-[11px] text-white/60">
              Donate an AI account and everyone can use it for free (paid with Kleos). Credentials are
              health-checked, stored encrypted, used only to serve requests — withdraw any time.
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
        )}
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

// Native providers that can be donated straight from your local accounts.
const NATIVE_PROVIDERS = [
  { id: "codebuddy", label: "CodeBuddy" },
  { id: "codebuddy-cn", label: "CodeBuddy CN" },
  { id: "kiro", label: "Kiro" },
  { id: "codex", label: "Codex" },
];

function DonateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<"manual" | "local">("local");
  const [tpl, setTpl] = useState(TEMPLATES[0]);
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelsText, setModelsText] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [err, setErr] = useState("");
  const keyRef = useRef<HTMLInputElement>(null);

  // Local-accounts donation: pick a provider + how many to donate.
  const [localProvider, setLocalProvider] = useState(NATIVE_PROVIDERS[0].id);
  const [quantity, setQuantity] = useState(1);

  const submitLocal = async () => {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const r = await accountsApi.donateBulk(localProvider, quantity);
      if (r.donated === 0) {
        setErr(r.last_error || `No live ${localProvider} accounts to donate (checked ${r.checked}).`);
        return;
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "donation failed");
    } finally { setBusy(false); }
  };

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
          {/* Source: donate from your local accounts, or add a manual endpoint. */}
          <div className="flex rounded-lg border border-white/10 bg-white/[0.02] p-0.5 text-xs">
            <button onClick={() => { setMode("local"); setErr(""); }} className={`flex-1 rounded-md px-2 py-1.5 font-medium ${mode === "local" ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"}`}>From my accounts</button>
            <button onClick={() => { setMode("manual"); setErr(""); }} className={`flex-1 rounded-md px-2 py-1.5 font-medium ${mode === "manual" ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"}`}>Manual (endpoint)</button>
          </div>

          {mode === "local" ? (
            <>
              <p className="text-[11px] text-white/40">Donate accounts you already added (Kiro/Codex/CodeBuddy). Pick a provider and how many — we auto-pick the active ones, verify each works, then move them to the pool.</p>
              <div>
                <label className="mb-1 block text-[11px] text-white/50">Provider</label>
                <select value={localProvider} onChange={(e) => setLocalProvider(e.target.value)} className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-white/25">
                  {NATIVE_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-white/50">How many</label>
                <input type="number" min={1} max={100} value={quantity} onChange={(e) => setQuantity(Math.min(100, Math.max(1, Number(e.target.value) || 1)))} className="w-28 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-white/25" />
              </div>
              {err && <p className="text-[11px] text-red-300">{err}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-white/50 hover:bg-white/5">Cancel</button>
                <button onClick={submitLocal} disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black hover:opacity-90 disabled:opacity-40">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gift className="h-3.5 w-3.5" />} {busy ? "Checking…" : `Donate ${quantity}`}
                </button>
              </div>
            </>
          ) : (
          <>
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
          </>
          )}
        </div>
      </div>
    </div>
  );
}
