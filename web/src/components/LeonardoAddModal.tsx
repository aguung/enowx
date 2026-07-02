import { useEffect, useRef, useState } from "react";
import { X, ExternalLink, Loader2 } from "lucide-react";
import { ProviderIcon } from "./ProviderIcon";
import { accountsApi, leonardoApi, type Provider } from "../lib/api";

type Tab = "browser" | "manual";
const TABS: { id: Tab; label: string }[] = [
  { id: "browser", label: "From Browser" },
  { id: "manual", label: "Manual" },
];

export function LeonardoAddModal({ provider, onClose, onSaved }: { provider: Provider; onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState<Tab>("browser");
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[85%] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#11131a] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-white/5 px-4 py-3">
          <ProviderIcon icon={provider.icon} label={provider.label} size={32} />
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">Add Leonardo account</p>
            <p className="text-[11px] text-white/40">Image generation. Stored locally.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex gap-1 border-b border-white/5 px-3 py-2">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`rounded-md px-2.5 py-1 text-xs transition-colors ${tab === t.id ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"}`}>{t.label}</button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {tab === "browser" ? <BrowserTab onSaved={onSaved} /> : <ManualTab onSaved={onSaved} />}
        </div>
      </div>
    </div>
  );
}

function Err({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{msg}</div>;
}

function Primary({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button onClick={onClick} disabled={disabled} className="w-full rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:opacity-90 disabled:opacity-50">{children}</button>;
}

function BrowserTab({ onSaved }: { onSaved: () => void }) {
  const [session, setSession] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  const start = async () => {
    setErr("");
    setBusy(true);
    try {
      const { session } = await leonardoApi.browserStart();
      setSession(session);
      setWaiting(true);
      timer.current = window.setInterval(async () => {
        try {
          const r = await leonardoApi.browserPoll(session);
          if (r.ready) {
            if (timer.current) window.clearInterval(timer.current);
            onSaved();
          }
        } catch { /* keep polling */ }
      }, 3000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to open browser");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (timer.current) window.clearInterval(timer.current);
    if (session) await leonardoApi.browserCancel(session).catch(() => {});
    setWaiting(false);
    setSession("");
  };

  if (waiting) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-xs text-white/70">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo-300" />
          A browser window opened — sign in with Canva, then open Leonardo. This closes automatically once your session is detected.
        </div>
        <button onClick={cancel} className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/5">Cancel</button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-white/50">Opens the Canva → Leonardo page in a real browser. Log in with your Canva Business account and continue into Leonardo — enowx reads your session automatically (no copy/paste) once you're in.</p>
      <Err msg={err} />
      <Primary onClick={start} disabled={busy}>
        <span className="flex items-center justify-center gap-1.5">{busy ? "Opening…" : "Open Leonardo login"} <ExternalLink className="h-3.5 w-3.5" /></span>
      </Primary>
      <p className="text-[11px] text-white/35">Requires Chrome, Edge, or Chromium installed. If none is found, use the Manual tab.</p>
    </div>
  );
}

function ManualTab({ onSaved }: { onSaved: () => void }) {
  const [token, setToken] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr("");
    setBusy(true);
    try {
      await accountsApi.add({ provider: "leonardo", creds: { access_token: token.trim() } });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-white/50">
        Paste a Leonardo access token (JWT). Get it from <span className="font-mono">app.leonardo.ai/api/auth/get-session</span> → the <span className="font-mono">accessToken</span> field.
      </p>
      <textarea value={token} onChange={(e) => setToken(e.target.value)} spellCheck={false} placeholder="eyJ…" className="h-28 w-full resize-none rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-xs text-white placeholder:text-white/25 focus:border-white/25 focus:outline-none" />
      <Err msg={err} />
      <Primary onClick={submit} disabled={busy || !token.trim()}>{busy ? "Saving…" : "Add account"}</Primary>
    </div>
  );
}
