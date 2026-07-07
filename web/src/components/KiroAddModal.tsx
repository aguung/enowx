import { useEffect, useRef, useState } from "react";
import { X, ExternalLink, Copy, Check, RefreshCw, Download } from "lucide-react";
import { ProviderIcon } from "./ProviderIcon";
import { kiroApi, localApi, type AwsStart, type LocalSource, type Provider } from "../lib/api";
import { copyText } from "../os/clipboard";

type Tab = "oauth" | "aws" | "refresh" | "manual";

const TABS: { id: Tab; label: string }[] = [
  { id: "oauth", label: "OAuth" },
  { id: "aws", label: "AWS" },
  { id: "refresh", label: "Refresh token" },
  { id: "manual", label: "Manual" },
];

export function KiroAddModal({
  provider,
  onClose,
  onSaved,
}: {
  provider: Provider;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<Tab>("oauth");

  return (
    <div className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[85%] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#11131a] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-white/5 px-4 py-3">
          <ProviderIcon icon={provider.icon} label={provider.label} size={32} />
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">Add Kiro account</p>
            <p className="text-[11px] text-white/40">Stored locally. Choose a method.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-white/5 px-3 py-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                tab === t.id ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {tab === "oauth" && <OAuthTab onSaved={onSaved} />}
          {tab === "aws" && <AwsTab onSaved={onSaved} />}
          {tab === "refresh" && <RefreshTab onSaved={onSaved} />}
          {tab === "manual" && <ManualTab onSaved={onSaved} />}
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
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function ManualTab({ onSaved }: { onSaved: () => void }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const format = () => {
    try {
      setText(JSON.stringify(JSON.parse(text), null, 2));
      setErr("");
    } catch {
      setErr("Not valid JSON yet");
    }
  };
  const submit = async () => {
    setErr("");
    setSaving(true);
    try {
      await kiroApi.manual(text);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/50">Paste the contents of your kiro-auth-token.json.</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={format}
        spellCheck={false}
        placeholder={'{\n  "accessToken": "...",\n  "refreshToken": "...",\n  "profileArn": "..."\n}'}
        className="h-44 w-full resize-none rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-xs text-white placeholder:text-white/25 focus:border-white/25 focus:outline-none"
      />
      <Err msg={err} />
      <div className="flex gap-2">
        <button onClick={format} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70 hover:bg-white/5">
          Format
        </button>
        <PrimaryBtn onClick={submit} disabled={saving || !text.trim()}>
          {saving ? "Saving..." : "Add account"}
        </PrimaryBtn>
      </div>
    </div>
  );
}

// RefreshTab: paste a refresh token manually, OR pull it from the Kiro IDE/CLI
// logged in on this machine (rescan + import).
function RefreshTab({ onSaved }: { onSaved: () => void }) {
  const [token, setToken] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [sources, setSources] = useState<LocalSource[] | null>(null);
  const [importing, setImporting] = useState("");

  const scan = async () => {
    setErr("");
    try {
      const rows = await localApi.scan();
      setSources(rows.filter((s) => s.provider === "kiro"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "scan failed");
      setSources([]);
    }
  };
  useEffect(() => { scan(); }, []);

  const submit = async () => {
    setErr("");
    setSaving(true);
    try {
      await kiroApi.refresh(token.trim(), region.trim());
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setSaving(false);
    }
  };
  const doImport = async (s: LocalSource) => {
    setErr("");
    setImporting(s.target);
    try {
      await localApi.import(s.provider, s.target);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "import failed");
    } finally {
      setImporting("");
    }
  };

  return (
    <div className="space-y-3">
      {/* From IDE/CLI */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-white/50">Pull the token from Kiro IDE/CLI on this machine.</p>
        <button onClick={scan} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-white/60 hover:bg-white/5 hover:text-white">
          <RefreshCw className="h-3 w-3" /> Rescan
        </button>
      </div>
      {sources === null ? (
        <div className="h-12 animate-pulse rounded-lg bg-white/5" />
      ) : sources.length === 0 ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-center text-[11px] text-white/40">
          No local Kiro login found — paste a refresh token below instead.
        </div>
      ) : (
        <div className="space-y-2">
          {sources.map((s) => (
            <div key={s.target} className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">{s.target}</p>
                <p className="truncate font-mono text-[10px] text-white/35">{s.path}</p>
              </div>
              <button onClick={() => doImport(s)} disabled={!!importing} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black hover:opacity-90 disabled:opacity-50">
                <Download className="h-3.5 w-3.5" /> {importing === s.target ? "Importing…" : "Import"}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1 text-[10px] uppercase tracking-wide text-white/25">
        <div className="h-px flex-1 bg-white/10" /> or paste manually <div className="h-px flex-1 bg-white/10" />
      </div>

      {/* Manual refresh token */}
      <Input label="Refresh token" value={token} onChange={setToken} secret />
      <Input label="SSO region" value={region} onChange={setRegion} />
      <Err msg={err} />
      <PrimaryBtn onClick={submit} disabled={saving || !token.trim()}>
        {saving ? "Saving…" : "Add account"}
      </PrimaryBtn>
    </div>
  );
}

function AwsTab({ onSaved }: { onSaved: () => void }) {
  const [mode, setMode] = useState<"builder-id" | "idc">("builder-id");
  const [region, setRegion] = useState("us-east-1");
  const [startUrl, setStartUrl] = useState("");
  const [start, setStart] = useState<AwsStart | null>(null);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const poll = useRef<number | null>(null);

  useEffect(() => () => { if (poll.current) window.clearInterval(poll.current); }, []);

  const begin = async () => {
    setErr("");
    setBusy(true);
    try {
      const s = await kiroApi.awsStart({ region: region.trim(), auth_method: mode, start_url: startUrl.trim() });
      setStart(s);
      setStatus("Waiting for authorization...");
      poll.current = window.setInterval(async () => {
        try {
          const r = await kiroApi.awsPoll(s.session);
          if (r.status === "done") {
            if (poll.current) window.clearInterval(poll.current);
            onSaved();
          }
        } catch (e) {
          if (poll.current) window.clearInterval(poll.current);
          setErr(e instanceof Error ? e.message : "poll failed");
        }
      }, Math.max(2, s.interval) * 1000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };

  if (start) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-white/50">Open the link, enter the code, and approve. This window will finish automatically.</p>
        <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-center">
          <p className="text-[11px] uppercase tracking-wide text-white/40">User code</p>
          <p className="my-1 font-mono text-2xl font-bold tracking-widest text-emerald-300">{start.user_code}</p>
        </div>
        <a
          href={start.verification_uri_complete}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:opacity-90"
        >
          Open AWS verification <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <p className="text-center font-mono text-[11px] text-white/40">{status}</p>
        <Err msg={err} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/50">Sign in with AWS via device code. Builder ID for the default Kiro flow, or IAM Identity Center for enterprise AWS SSO.</p>
      <div className="grid grid-cols-2 gap-2">
        {([{ k: "builder-id", label: "Builder ID" }, { k: "idc", label: "Identity Center" }] as const).map((o) => (
          <button
            key={o.k}
            onClick={() => setMode(o.k)}
            className={`rounded-lg border px-3 py-2 text-xs ${mode === o.k ? "border-white/30 bg-white/10 text-white" : "border-white/10 text-white/50 hover:bg-white/5"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <Input label="SSO region" value={region} onChange={setRegion} />
      {mode === "idc" && <Input label="Start URL (IdC portal)" value={startUrl} onChange={setStartUrl} />}
      <Err msg={err} />
      <PrimaryBtn onClick={begin} disabled={busy || (mode === "idc" && !startUrl.trim())}>
        {busy ? "Starting..." : "Start AWS login"}
      </PrimaryBtn>
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
    setErr("");
    setBusy(true);
    try {
      const s = await kiroApi.oauthStart();
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
      await kiroApi.oauthExchange(session, code.trim());
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
        <p className="text-xs text-white/50">Sign in with Google. A browser tab opens; after approving, paste the code back here.</p>
        <Err msg={err} />
        <PrimaryBtn onClick={begin} disabled={busy}>
          {busy ? "Starting..." : "Start Google login"}
        </PrimaryBtn>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/50">After approving in the browser, paste the redirect code (from the kiro:// URL).</p>
      <div
        onClick={() => {
          copyText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2"
      >
        <span className="truncate font-mono text-[11px] text-white/60">{url}</span>
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5 text-white/40" />}
      </div>
      <Input label="Authorization code" value={code} onChange={setCode} />
      <Err msg={err} />
      <PrimaryBtn onClick={submit} disabled={busy || !code.trim()}>
        {busy ? "Verifying..." : "Add account"}
      </PrimaryBtn>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  secret,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  secret?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-white/50">{label}</span>
      <input
        type={secret ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/25 focus:outline-none"
      />
    </label>
  );
}
