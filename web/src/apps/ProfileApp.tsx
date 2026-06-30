import { useEffect, useRef, useState } from "react";
import { Loader2, LogOut, LogIn, RefreshCw, Check, ShieldCheck, Sparkles } from "lucide-react";
import { AppShell } from "./shell";
import { Tooltip } from "../components/Tooltip";
import { useProfile } from "../os/useProfile";
import { syncApi } from "../lib/api";

// ProfileApp is the account surface: sign in with Discord to unlock features
// (sync runs automatically in the background once signed in). No server URL to
// configure — the cloud endpoint is built into enowx.
export function ProfileApp() {
  const profile = useProfile();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [synced, setSynced] = useState("");
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, []);

  async function connect() {
    setError("");
    setBusy("Opening Discord…");
    try {
      const { authorize_url, state } = await profile.startLogin();
      window.open(authorize_url, "_blank", "noopener");
      setBusy("Waiting for Discord authorization…");
      poll.current = setInterval(async () => {
        try {
          const done = await profile.pollLogin(state);
          if (done) {
            if (poll.current) clearInterval(poll.current);
            setBusy("");
          }
        } catch {
          /* keep polling */
        }
      }, 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "couldn't reach the server");
      setBusy("");
    }
  }

  async function logout() {
    setBusy("Signing out…");
    try {
      await profile.logout();
    } finally {
      setBusy("");
    }
  }

  async function syncNow() {
    setSynced("");
    setBusy("Syncing…");
    try {
      const r = await syncApi.now();
      setSynced(`Synced · ${r.pushed} up, ${r.pulled} down`);
      setTimeout(() => setSynced(""), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "sync failed");
    } finally {
      setBusy("");
    }
  }

  if (profile.loading) {
    return (
      <AppShell title="Profile" subtitle="Your enowx account">
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-white/40" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Profile" subtitle="Your enowx account">
      {error && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

      {profile.loggedIn && profile.user ? (
        <div className="space-y-4">
          {/* Identity card */}
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
            {profile.user.avatar_url ? (
              <img src={profile.user.avatar_url} alt="" className="h-12 w-12 rounded-full" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/40 to-violet-600/40 text-lg font-bold text-white">
                {(profile.user.username || "?").charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-white">{profile.user.username || "Signed in"}</div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
                  {profile.user.plan}
                </span>
                <span className="text-[11px] text-white/40">signed in with Discord</span>
              </div>
            </div>
          </div>

          {/* What login unlocks */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/40">
              <Sparkles className="h-3 w-3" /> Account
            </div>
            <p className="text-xs leading-relaxed text-white/55">
              Your playlists sync automatically across signed-in devices. More account-gated features will appear here.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Tooltip label="Sync your data now" place="bottom">
                <button
                  onClick={syncNow}
                  disabled={!!busy}
                  className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/15 disabled:opacity-50"
                >
                  {busy === "Syncing…" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Sync now
                </button>
              </Tooltip>
              {synced && (
                <span className="flex items-center gap-1 text-[11px] text-emerald-300">
                  <Check className="h-3 w-3" /> {synced}
                </span>
              )}
            </div>
          </div>

          <Tooltip label="Sign out of this device" place="bottom">
            <button
              onClick={logout}
              disabled={!!busy}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/60 hover:bg-white/5 hover:text-white disabled:opacity-50"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </Tooltip>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/30 to-violet-600/30">
            <ShieldCheck className="h-7 w-7 text-indigo-200" />
          </div>
          <h2 className="text-sm font-semibold text-white">Sign in to enowx</h2>
          <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-white/50">
            Connect your Discord account to sync across devices and unlock account features. enowx works fine without
            signing in — login just adds more.
          </p>
          <Tooltip label="Sign in with Discord" place="bottom">
            <button
              onClick={connect}
              disabled={!!busy}
              className="mt-4 flex items-center gap-1.5 rounded-lg bg-[#5865F2] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
              Connect Discord
            </button>
          </Tooltip>
          {busy && <p className="mt-2 text-[11px] text-white/45">{busy}</p>}
        </div>
      )}
    </AppShell>
  );
}
