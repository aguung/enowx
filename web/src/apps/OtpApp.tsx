import { useEffect, useState } from "react";
import { Loader2, KeyRound, Phone, RefreshCw, Copy, Check, X, Wallet, Trash2 } from "lucide-react";
import { AppShell } from "./shell";
import { useDialog } from "../os/dialog";
import { copyText } from "../os/clipboard";
import { otpApi, type OtpConfig, type OtpService, type OtpCountry, type OtpOrder } from "../lib/api";

const idr = (n: number) => `Rp${(n ?? 0).toLocaleString("id-ID")}`;

export function OtpApp() {
  const [config, setConfig] = useState<OtpConfig | null>(null);
  const [showKey, setShowKey] = useState(false);
  const dialog = useDialog();

  const loadConfig = () => otpApi.getConfig().then(setConfig).catch(() => setConfig({ has_key: false }));
  useEffect(() => { loadConfig(); }, []);

  if (config === null) {
    return (
      <AppShell title="OTP" subtitle="Disposable SMS numbers">
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-white/30" /></div>
      </AppShell>
    );
  }

  if (!config.has_key || showKey) {
    return (
      <AppShell title="OTP" subtitle="Disposable SMS numbers">
        <KeyConfig
          config={config}
          onSaved={() => { setShowKey(false); loadConfig(); }}
          onDelete={async () => {
            const ok = await dialog.confirm({ title: "Remove Warpize key?", message: "You'll need to re-enter it to rent numbers.", confirmLabel: "Remove", danger: true });
            if (ok) { await otpApi.deleteConfig().catch(() => {}); setShowKey(false); loadConfig(); }
          }}
          onCancel={config.has_key ? () => setShowKey(false) : undefined}
        />
      </AppShell>
    );
  }

  return (
    <AppShell title="OTP" subtitle="Disposable SMS numbers">
      <Rental onEditKey={() => setShowKey(true)} />
    </AppShell>
  );
}

// KeyConfig: enter/replace the user's own Warpize (wz_live_) key.
function KeyConfig({ config, onSaved, onDelete, onCancel }: {
  config: OtpConfig; onSaved: () => void; onDelete: () => void; onCancel?: () => void;
}) {
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!key.trim() || saving) return;
    setSaving(true); setError("");
    try { await otpApi.saveConfig(key.trim()); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : "failed to save"); }
    finally { setSaving(false); }
  };

  return (
    <div className="mx-auto max-w-md space-y-3">
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-white/85">
          <KeyRound className="h-4 w-4 text-cyan-300" /> Warpize API key
        </div>
        <p className="mb-3 text-[11px] text-white/45">
          Rent disposable SMS numbers for OTP codes. Bring your own Warpize key (<span className="font-mono">wz_live_…</span>) — get one at warpize.com. Your key is stored encrypted; enowX never sees the codes.
        </p>
        {config.has_key && config.preview && (
          <p className="mb-2 text-[11px] text-white/40">Current key: <span className="font-mono text-white/60">{config.preview}</span></p>
        )}
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="wz_live_…"
          className="w-full rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 font-mono text-xs text-white/80 outline-none focus:border-white/25"
        />
        {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}
        <div className="mt-3 flex items-center justify-between">
          {config.has_key ? (
            <button onClick={onDelete} className="flex items-center gap-1 text-[11px] text-white/40 hover:text-red-300"><Trash2 className="h-3 w-3" /> Remove key</button>
          ) : <span />}
          <div className="flex gap-2">
            {onCancel && <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs text-white/50 hover:bg-white/5">Cancel</button>}
            <button onClick={save} disabled={saving || !key.trim()} className="flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black hover:opacity-90 disabled:opacity-40">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Rental: pick a service + country, rent a number, poll for the OTP code.
function Rental({ onEditKey }: { onEditKey: () => void }) {
  const [services, setServices] = useState<OtpService[]>([]);
  const [countries, setCountries] = useState<OtpCountry[]>([]);
  const [service, setService] = useState("");
  const [country, setCountry] = useState("");
  const [balance, setBalance] = useState<{ balance: number; currency: string } | null>(null);
  const [orders, setOrders] = useState<OtpOrder[]>([]);
  const [renting, setRenting] = useState(false);
  const [error, setError] = useState("");
  const dialog = useDialog();

  const loadOrders = () => otpApi.list().then((r) => setOrders(r.orders ?? [])).catch(() => {});
  const loadBalance = () => otpApi.balance().then(setBalance).catch(() => {});

  useEffect(() => {
    otpApi.services().then((r) => setServices(r.services ?? [])).catch(() => {});
    otpApi.countries().then((r) => setCountries(r.countries ?? [])).catch(() => {});
    loadBalance();
    loadOrders();
  }, []);

  // Poll active (waiting) orders for their code every 4s.
  useEffect(() => {
    const hasWaiting = orders.some((o) => o.status === "waiting");
    if (!hasWaiting) return;
    const id = setInterval(async () => {
      const waiting = orders.filter((o) => o.status === "waiting");
      await Promise.allSettled(waiting.map((o) => otpApi.poll(o.id)));
      loadOrders();
    }, 4000);
    return () => clearInterval(id);
  }, [orders]);

  const rent = async () => {
    if (!service || !country || renting) return;
    setRenting(true); setError("");
    try { await otpApi.rent(service, country); loadOrders(); loadBalance(); }
    catch (e) { setError(e instanceof Error ? e.message : "failed to rent"); }
    finally { setRenting(false); }
  };

  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); loadOrders(); loadBalance(); } catch { /* ignore */ }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Header: balance + settings */}
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] text-white/50">
          <Wallet className="h-3.5 w-3.5" /> {balance ? idr(balance.balance) : "…"}
          <button onClick={loadBalance} className="ml-1 text-white/30 hover:text-white/60"><RefreshCw className="h-3 w-3" /></button>
        </span>
        <button onClick={onEditKey} className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-white/50 hover:bg-white/10 hover:text-white">
          <KeyRound className="h-3 w-3" /> Key
        </button>
      </div>

      {/* Rent form */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[130px] flex-1">
            <span className="text-[10px] uppercase tracking-wide text-white/35">Service</span>
            <select value={service} onChange={(e) => setService(e.target.value)} className="mt-0.5 w-full rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-xs text-white/80 outline-none">
              <option value="" className="bg-[#15161c]">Select…</option>
              {services.map((s) => <option key={s.code} value={s.code} className="bg-[#15161c]">{s.name}</option>)}
            </select>
          </label>
          <label className="min-w-[110px] flex-1">
            <span className="text-[10px] uppercase tracking-wide text-white/35">Country</span>
            <select value={country} onChange={(e) => setCountry(e.target.value)} className="mt-0.5 w-full rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-xs text-white/80 outline-none">
              <option value="" className="bg-[#15161c]">Select…</option>
              {countries.map((c) => <option key={c.code} value={c.code} className="bg-[#15161c]">{c.name}</option>)}
            </select>
          </label>
          <button onClick={rent} disabled={!service || !country || renting} className="flex h-[34px] items-center gap-1 rounded-lg bg-white px-3 text-xs font-medium text-black hover:opacity-90 disabled:opacity-40">
            {renting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Phone className="h-3.5 w-3.5" />} Rent
          </button>
        </div>
        {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}
      </div>

      {/* Orders */}
      <div className="min-h-0 flex-1 overflow-auto">
        {orders.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-xs text-white/40">No numbers rented yet.</div>
        ) : (
          <div className="space-y-2">
            {orders.map((o) => <OrderCard key={o.id} o={o} onFinish={() => act(() => otpApi.finish(o.id))} onCancel={() => act(() => otpApi.cancel(o.id))} onAnother={() => act(() => otpApi.another(o.id))} dialog={dialog} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function OrderCard({ o, onFinish, onCancel, onAnother }: {
  o: OtpOrder; onFinish: () => void; onCancel: () => void; onAnother: () => void; dialog: ReturnType<typeof useDialog>;
}) {
  const [copied, setCopied] = useState<"num" | "code" | null>(null);
  const copy = (v: string, which: "num" | "code") => { copyText(v); setCopied(which); setTimeout(() => setCopied(null), 1200); };
  const statusColor = o.status === "received" || o.status === "finished" ? "text-emerald-300 bg-emerald-500/15"
    : o.status === "waiting" ? "text-amber-300 bg-amber-500/15" : "text-white/40 bg-white/5";

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium capitalize text-white/85">{o.service}</span>
        <span className="text-[10px] uppercase text-white/35">{o.country}</span>
        <span className={`ml-auto rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${statusColor}`}>{o.status}</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button onClick={() => copy(o.number, "num")} className="flex items-center gap-1 rounded-md bg-black/25 px-2 py-1 font-mono text-xs text-white/75 hover:bg-black/40" title="Copy number">
          {o.number || "—"} {copied === "num" ? <Check className="h-3 w-3 text-emerald-300" /> : <Copy className="h-3 w-3 text-white/30" />}
        </button>
        <span className="ml-auto text-[11px] text-white/40">{idr(o.price)}</span>
      </div>
      {/* OTP code */}
      <div className="mt-2 flex items-center gap-2">
        {o.code ? (
          <button onClick={() => copy(o.code, "code")} className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-2.5 py-1.5 font-mono text-sm font-semibold tracking-wider text-emerald-200 hover:bg-emerald-500/25" title="Copy code">
            {o.code} {copied === "code" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5 opacity-60" />}
          </button>
        ) : o.status === "waiting" ? (
          <span className="flex items-center gap-1.5 text-[11px] text-white/40"><Loader2 className="h-3 w-3 animate-spin" /> Waiting for SMS…</span>
        ) : (
          <span className="text-[11px] text-white/30">No code</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {o.code && <button onClick={onFinish} title="Confirm it worked" className="rounded-md p-1.5 text-emerald-300/70 hover:bg-white/10"><Check className="h-3.5 w-3.5" /></button>}
          {o.status === "waiting" && <button onClick={onAnother} title="Request another SMS" className="rounded-md p-1.5 text-white/40 hover:bg-white/10"><RefreshCw className="h-3.5 w-3.5" /></button>}
          {o.status === "waiting" && <button onClick={onCancel} title="Cancel (refund)" className="rounded-md p-1.5 text-white/40 hover:bg-red-500/30 hover:text-red-200"><X className="h-3.5 w-3.5" /></button>}
        </div>
      </div>
    </div>
  );
}
