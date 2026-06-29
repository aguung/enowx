import { useState } from "react";
import { Globe, Power, Copy, Check, Loader2, ExternalLink, ShieldAlert, Zap, Link2, KeySquare } from "lucide-react";
import { AppShell } from "./shell";
import { Tooltip } from "../components/Tooltip";
import { useDialog } from "../os/dialog";
import { usePersisted } from "../os/usePersisted";
import { useTunnel } from "../os/useTunnel";
import { useKeys } from "../os/useKeys";
import { tunnelApi } from "../lib/api";

type Mode = "quick" | "named";

export function TunnelApp() {
  const { status, enableQuick, disable, named, startLogin } = useTunnel();
  const { keys, add: addKey } = useKeys();
  const [mode, setMode] = usePersisted<Mode>("tunnel-mode", "quick");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [loginLog, setLoginLog] = useState<string[]>([]);
  const [hostname, setHostname] = usePersisted("tunnel-hostname", "");
  const dialog = useDialog();

  const enabled = status?.enabled ?? false;
  const url = status?.url ?? "";
  // The backend refuses to expose an unauthenticated gateway, so guide the user
  // to create a key first instead of letting them hit a 403.
  const needsKey = keys !== null && keys.length === 0;

  async function createFirstKey() {
    setBusy("Creating API key…");
    try {
      await addKey({ label: "tunnel" });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to create key");
    } finally {
      setBusy("");
    }
  }

  async function onEnableQuick() {
    setError("");
    setBusy("Connecting…");
    // Poll real status while the (blocking) enable runs, so we only show
    // "Downloading" when cloudflared is actually being fetched.
    const poll = setInterval(async () => {
      try {
        const s = await tunnelApi.status();
        if (s.downloading) setBusy(`Downloading cloudflared… ${s.download_pct}%`);
        else setBusy("Connecting…");
      } catch {
        /* ignore */
      }
    }, 700);
    try {
      await enableQuick();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to enable");
    } finally {
      clearInterval(poll);
      setBusy("");
    }
  }

  async function onDisable() {
    setBusy("Stopping…");
    try {
      await disable();
    } finally {
      setBusy("");
    }
  }

  async function onNamed() {
    const host = hostname.trim();
    if (!host) {
      await dialog.alert({ title: "Hostname required", message: "Enter the hostname you want to expose, e.g. enowx.example.com." });
      return;
    }
    setError("");
    setLoginLog([]);
    try {
      // 1) Browser login (if needed). Streams an authorization URL to open.
      if (!status?.logged_in) {
        setBusy("Starting Cloudflare login…");
        await startLogin({
          onMessage: (m) => setLoginLog((l) => [...l, m].slice(-8)),
          onAuthUrl: async (u) => {
            window.open(u, "_blank", "noopener");
            await dialog.alert({
              title: "Authorize in your browser",
              message: "A Cloudflare page was opened. Pick the domain you want to use, then come back — this continues automatically.",
            });
          },
        });
      }
      // 2) Create + route + run on the hostname.
      setBusy("Creating tunnel & routing DNS…");
      await named(host);
    } catch (e) {
      setError(e instanceof Error ? e.message : "named tunnel failed");
    } finally {
      setBusy("");
    }
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <AppShell title="Tunnel" subtitle="Expose this gateway to the public internet">
      {/* Public-exposure warning */}
      <div className="mb-3 flex gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
        <p className="text-[11px] leading-relaxed text-amber-200/80">
          A tunnel makes this gateway reachable from anywhere. It only turns on when at least one gateway API key
          exists, so requests stay authenticated. Loopback-only tools (terminal, files) remain local.
        </p>
      </div>

      {error && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

      {/* No API key yet: guide the user instead of letting them hit a 403. */}
      {needsKey && !enabled && (
        <div className="mb-4 rounded-xl border border-cyan-500/25 bg-cyan-500/[0.06] p-3.5">
          <div className="flex items-center gap-2">
            <KeySquare className="h-4 w-4 text-cyan-300" />
            <span className="text-sm font-semibold text-white">Create an API key first</span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-white/55">
            The tunnel won&apos;t expose an unauthenticated gateway. Create a gateway API key, then enable the tunnel.
            Manage keys anytime in the API Keys app (Ctrl/Alt+K).
          </p>
          <Tooltip label="Create a gateway API key" place="bottom">
            <button
              onClick={createFirstKey}
              disabled={!!busy}
              className="mt-3 flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-black hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeySquare className="h-3.5 w-3.5" />}
              Create API key
            </button>
          </Tooltip>
        </div>
      )}

      {/* Live status */}
      <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${enabled ? "bg-emerald-400" : "bg-white/25"}`} />
          <span className="text-sm font-semibold text-white">{enabled ? "Online" : "Offline"}</span>
          {status?.mode && enabled && (
            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/50">{status.mode}</span>
          )}
          {busy && (
            <span className="ml-auto flex items-center gap-1.5 text-[11px] text-white/50">
              <Loader2 className="h-3 w-3 animate-spin" /> {busy}
            </span>
          )}
        </div>

        {enabled && url && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2.5 py-2">
            <Globe className="h-3.5 w-3.5 shrink-0 text-emerald-300/80" />
            <a href={url} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate font-mono text-xs text-emerald-200 hover:underline">
              {url}
            </a>
            <Tooltip label="Open" place="bottom">
              <a href={url} target="_blank" rel="noopener" className="rounded p-1 text-white/45 hover:bg-white/10 hover:text-white">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Tooltip>
            <Tooltip label={copied ? "Copied" : "Copy URL"} place="bottom">
              <button onClick={copyUrl} className="rounded p-1 text-white/45 hover:bg-white/10 hover:text-white">
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </Tooltip>
          </div>
        )}

        {enabled && (
          <Tooltip label="Stop the tunnel" place="bottom">
            <button
              onClick={onDisable}
              disabled={!!busy}
              className="mt-3 flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-500/20 disabled:opacity-50"
            >
              <Power className="h-3.5 w-3.5" /> Disable tunnel
            </button>
          </Tooltip>
        )}
      </div>

      {!enabled && !needsKey && (
        <>
          {/* Mode picker */}
          <div className="mb-3 flex gap-1">
            <ModeTab id="quick" active={mode === "quick"} onClick={() => setMode("quick")} icon={Zap} label="Quick" />
            <ModeTab id="named" active={mode === "named"} onClick={() => setMode("named")} icon={Link2} label="Custom domain" />
          </div>

          {mode === "quick" ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
              <p className="text-xs leading-relaxed text-white/55">
                Get a random public URL on <span className="font-mono text-white/70">trycloudflare.com</span> instantly — no
                account or domain. The URL changes each time you enable it.
              </p>
              <Tooltip label="Start a quick tunnel" place="bottom">
                <button
                  onClick={onEnableQuick}
                  disabled={!!busy}
                  className="mt-3 flex items-center gap-1.5 rounded-lg bg-white text-black px-3 py-1.5 text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                  Enable quick tunnel
                </button>
              </Tooltip>
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
              <p className="text-xs leading-relaxed text-white/55">
                Expose on your own domain. You&apos;ll authorize cloudflared in your browser (one time), then enowx
                creates the tunnel and routes the hostname to it.
              </p>
              <label className="mt-3 block">
                <span className="mb-1 block text-[11px] font-medium text-white/50">Hostname</span>
                <input
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  placeholder="enowx.example.com"
                  className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 font-mono text-xs text-white placeholder:text-white/25 focus:border-white/25 focus:outline-none"
                />
              </label>
              {status?.logged_in && (
                <p className="mt-1.5 flex items-center gap-1 text-[11px] text-emerald-300/80">
                  <Check className="h-3 w-3" /> Cloudflare account connected
                </p>
              )}
              <Tooltip label="Connect on your domain" place="bottom">
                <button
                  onClick={onNamed}
                  disabled={!!busy}
                  className="mt-3 flex items-center gap-1.5 rounded-lg bg-white text-black px-3 py-1.5 text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                  {status?.logged_in ? "Enable on hostname" : "Login & enable"}
                </button>
              </Tooltip>

              {loginLog.length > 0 && (
                <div className="mt-3 max-h-28 overflow-auto rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-white/45">
                  {loginLog.map((l, i) => (
                    <div key={i} className="truncate">{l}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}

function ModeTab({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  id: Mode;
  active: boolean;
  onClick: () => void;
  icon: typeof Zap;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
        active ? "bg-white/12 text-white" : "text-white/50 hover:bg-white/5 hover:text-white/80"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
