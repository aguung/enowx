import { useEffect, useState } from "react";
import { X, Copy, Check, Download, Loader2 } from "lucide-react";
import { ProviderIcon } from "./ProviderIcon";
import { claudeApi, localApi, type LocalSource, type Provider } from "../lib/api";
import { copyText } from "../os/clipboard";

// ClaudeAddModal adds a Claude (Claude Code subscription) account. Primary path
// is OAuth login (approve at claude.ai, paste the code); it can also import an
// existing local Claude Code login (keychain on macOS, file elsewhere).
export function ClaudeAddModal({
  provider,
  onClose,
  onSaved,
}: {
  provider: Provider;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<"oauth" | "local">("oauth");
  return (
    <div className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#11131a] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-white/5 px-4 py-3">
          <ProviderIcon icon={provider.icon} label={provider.label} size={32} />
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">Add Claude account</p>
            <p className="text-[11px] text-white/40">Sign in with your Claude subscription.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex gap-1 border-b border-white/5 px-3 pt-2">
          <Tab active={tab === "oauth"} onClick={() => setTab("oauth")}>Login</Tab>
          <Tab active={tab === "local"} onClick={() => setTab("local")}>Import from local</Tab>
        </div>

        <div className="max-h-[60vh] space-y-3 overflow-auto px-4 py-4">
          {tab === "oauth" ? <OAuthTab onSaved={onSaved} /> : <LocalTab onSaved={onSaved} />}
        </div>
      </div>
    </div>
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
    setErr(""); setBusy(true);
    try {
      const s = await claudeApi.oauthStart();
      setSession(s.session);
      setUrl(s.authorize_url);
      window.open(s.authorize_url, "_blank", "noreferrer");
    } catch (e) { setErr(e instanceof Error ? e.message : "failed"); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    setErr(""); setBusy(true);
    try { await claudeApi.oauthExchange(session, code.trim()); onSaved(); }
    catch (e) { setErr(e instanceof Error ? e.message : "failed"); }
    finally { setBusy(false); }
  };

  if (!url) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-white/50">A browser tab opens to claude.ai. Approve access, then paste the code shown back here.</p>
        <Err msg={err} />
        <Primary onClick={begin} disabled={busy}>{busy ? "Starting…" : "Login with Claude"}</Primary>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/50">Approve in the browser tab, then paste the authorization code it gives you.</p>
      <div
        onClick={() => { copyText(url); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
        className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2"
      >
        <span className="truncate font-mono text-[11px] text-white/60">{url}</span>
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5 text-white/40" />}
      </div>
      <div>
        <p className="mb-1 text-[11px] uppercase tracking-wide text-white/40">Authorization code</p>
        <input
          value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off"
          placeholder="paste code (may include #state)"
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/25 focus:outline-none"
        />
      </div>
      <Err msg={err} />
      <Primary onClick={submit} disabled={busy || !code.trim()}>{busy ? "Verifying…" : "Add account"}</Primary>
    </div>
  );
}

function LocalTab({ onSaved }: { onSaved: () => void }) {
  const [sources, setSources] = useState<LocalSource[] | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    localApi.scan().then((rows) => setSources(rows.filter((s) => s.provider === "claudecode"))).catch(() => setSources([]));
  }, []);

  const doImport = async (s: LocalSource) => {
    setErr(""); setBusy(s.target);
    try { await localApi.import(s.provider, s.target); onSaved(); }
    catch (e) { setErr(e instanceof Error ? e.message : "import failed"); }
    finally { setBusy(""); }
  };

  if (sources === null) return <div className="flex h-16 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-white/30" /></div>;
  if (sources.length === 0) {
    return <p className="text-xs text-white/50">No local Claude Code login found. Use the Login tab, or log in with the Claude Code CLI first.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-white/50">Found your Claude Code login on this machine. Import it as an account.</p>
      {sources.map((s) => (
        <button
          key={s.target} onClick={() => doImport(s)} disabled={!!busy}
          className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-xs text-white/80 hover:bg-white/[0.06] disabled:opacity-50"
        >
          {busy === s.target ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5 text-emerald-300" />}
          <span className="flex-1">{s.target}</span>
          <span className="truncate font-mono text-[10px] text-white/30">{s.path}</span>
        </button>
      ))}
      <Err msg={err} />
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-t-lg px-3 py-1.5 text-xs font-medium ${active ? "bg-white/10 text-white" : "text-white/45 hover:text-white/75"}`}>
      {children}
    </button>
  );
}
function Primary({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button onClick={onClick} disabled={disabled} className="w-full rounded-lg bg-white px-3 py-2 text-sm font-medium text-black hover:opacity-90 disabled:opacity-40">{children}</button>;
}
function Err({ msg }: { msg: string }) {
  return msg ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{msg}</div> : null;
}
