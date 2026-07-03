import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { useProfile } from "../os/useProfile";

// SignInGate is the shared, compact Discord sign-in card. It's used both as the
// signed-out state (Profile) and as a login gate in front of features that need
// an account (marketplace, plugin market) — so those never fire cloud requests
// while logged out (which would surface a scary "token revoked" error).
export function SignInGate({ reason }: { reason?: string }) {
  const profile = useProfile();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [authURL, setAuthURL] = useState("");
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);

  async function connect() {
    setError("");
    setBusy(true);
    setError("");
    setAuthURL("");
    try {
      const { authorize_url, state } = await profile.startLogin();
      // Open Discord in a NEW tab; keep enowx on this page. Never navigate the
      // current window — if the popup is blocked, offer a manual link instead.
      const win = window.open(authorize_url, "_blank");
      if (!win) setAuthURL(authorize_url);
      setStatus("Waiting for Discord…");
      poll.current = setInterval(async () => {
        try {
          if (await profile.pollLogin(state)) {
            if (poll.current) clearInterval(poll.current);
            setBusy(false);
            setStatus("");
          }
        } catch { /* keep polling */ }
      }, 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "couldn't reach the server");
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/30 to-violet-600/30">
        <ShieldCheck className="h-6 w-6 text-indigo-200" />
      </div>
      <h2 className="mt-3 text-sm font-semibold text-white">{reason ?? "Sign in to continue"}</h2>
      <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-white/45">
        Connect your Discord account to unlock this. enowx works fine without signing in — login just adds more.
      </p>
      <button
        onClick={connect}
        disabled={busy}
        className="mt-4 flex items-center gap-2 rounded-lg bg-[#5865F2] px-4 py-2 text-xs font-semibold text-white shadow-lg transition hover:bg-[#4752c4] disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <DiscordMark />}
        Continue with Discord
      </button>
      {status && <p className="mt-2 text-[11px] text-white/45">{status}</p>}
      {authURL && (
        <a href={authURL} target="_blank" rel="noreferrer" className="mt-2 text-[11px] text-indigo-300 underline hover:text-indigo-200">
          Popup blocked — click here to open Discord
        </a>
      )}
      {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}
    </div>
  );
}

function DiscordMark() {
  return (
    <svg viewBox="0 0 24 18" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M20.3 1.6A19.8 19.8 0 0 0 15.4.1l-.2.4c2.2.5 3.2 1.3 4.2 2.2A18.3 18.3 0 0 0 12 1.6c-2.6 0-5 .5-7.4 1.1 1-.9 2-1.7 4.2-2.2L8.6.1A19.8 19.8 0 0 0 3.7 1.6C.6 6.2-.3 10.7.2 15.1a20 20 0 0 0 6 3l.8-1.2c-.7-.3-1.4-.6-2-1l.5-.3c3.9 1.8 8.1 1.8 12 0l.5.3c-.6.4-1.3.7-2 1l.8 1.2a20 20 0 0 0 6-3c.6-5.2-.8-9.6-3.8-13.5ZM8.3 12.4c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm7.4 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z" />
    </svg>
  );
}
