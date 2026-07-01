import { useState } from "react";
import { X, ExternalLink, Copy, Check } from "lucide-react";
import { ProviderIcon } from "./ProviderIcon";
import { codexApi, type Provider } from "../lib/api";

type Tab = "oauth" | "manual";
const TABS: { id: Tab; label: string }[] = [
  { id: "oauth", label: "OAuth" },
  { id: "manual", label: "Manual" },
];

export function CodexAddModal({ provider, onClose, onSaved }: { provider: Provider; onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState<Tab>("oauth");
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[85%] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#11131a] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-white/5 px-4 py-3">
          <ProviderIcon icon={provider.icon} label={provider.label} size={32} />
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">Add Codex account</p>
            <p className="text-[11px] text-white/40">Sign in with a ChatGPT account. Stored locally.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex gap-1 border-b border-white/5 px-3 py-2">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`rounded-md px-2.5 py-1 text-xs transition-colors ${tab === t.id ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"}`}>{t.label}</button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {tab === "oauth" ? <OAuthTab onSaved={onSaved} /> : <ManualTab onSaved={onSaved} />}
        </div>
      </div>
    </div>
  );
}

function Err({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{msg}</div>;
}

function PrimaryBtn({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} className="w-full rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:opacity-90 disabled:opacity-50">{children}</button>
  );
}

function OAuthTab({ onSaved }: { onSaved: () => void }) {
  const [session, setSession] = useState("");
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const begin = async () => {
    setErr("");
    setBusy(true);
    try {
      const s = await codexApi.oauthStart();
      setSession(s.session);
      setUrl(s.authorize_url);
      window.open(s.authorize_url, "_blank", "noreferrer");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    setErr("");
    setBusy(true);
    try {
      await codexApi.oauthExchange(session, code.trim());
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };

  if (!url) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-white/50">Sign in with your ChatGPT account. A browser tab opens; after approving, the page will fail to load — that's expected. Copy the full URL from the address bar and paste it back here.</p>
        <Err msg={err} />
        <PrimaryBtn onClick={begin} disabled={busy}>{busy ? "Starting…" : "Start ChatGPT login"}</PrimaryBtn>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-white/50">After approving, the redirect to <span className="font-mono">localhost:1455</span> fails — paste that full URL (it contains the code).</p>
      <a href={url} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/70 hover:border-white/25">
        Open login again <ExternalLink className="h-3.5 w-3.5" />
      </a>
      <div onClick={() => { navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1200); }} className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2">
        <span className="truncate font-mono text-[11px] text-white/60">{url}</span>
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5 text-white/40" />}
      </div>
      <div>
        <label className="mb-1 block text-[11px] text-white/50">Callback URL (or code)</label>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="http://localhost:1455/auth/callback?code=…" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white outline-none focus:border-white/25" />
      </div>
      <Err msg={err} />
      <PrimaryBtn onClick={submit} disabled={busy || !code.trim()}>{busy ? "Saving…" : "Add account"}</PrimaryBtn>
    </div>
  );
}

function ManualTab({ onSaved }: { onSaved: () => void }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const format = () => {
    try { setText(JSON.stringify(JSON.parse(text), null, 2)); setErr(""); } catch { setErr("Not valid JSON yet"); }
  };
  const submit = async () => {
    setErr("");
    setSaving(true);
    try {
      await codexApi.manual(text);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-white/50">Paste your Codex auth.json (from the Codex CLI login).</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={format} spellCheck={false} placeholder={'{\n  "access_token": "...",\n  "refresh_token": "...",\n  "id_token": "..."\n}'} className="h-44 w-full resize-none rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-xs text-white placeholder:text-white/25 focus:border-white/25 focus:outline-none" />
      <Err msg={err} />
      <div className="flex gap-2">
        <button onClick={format} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70 hover:bg-white/5">Format</button>
        <PrimaryBtn onClick={submit} disabled={saving || !text.trim()}>{saving ? "Saving…" : "Add account"}</PrimaryBtn>
      </div>
    </div>
  );
}
