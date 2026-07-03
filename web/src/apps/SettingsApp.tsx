import { useEffect, useState } from "react";
import { Lock, LogOut, Loader2, Check, RefreshCw, Cloud, Bug, ImagePlus, X } from "lucide-react";
import { AppShell } from "./shell";
import { Tooltip } from "../components/Tooltip";
import { useDialog } from "../os/dialog";
import { authApi, settingsApi, syncApi, imageApi, bugApi, type AuthStatus, type Settings } from "../lib/api";
import { useProfile } from "../os/useProfile";

export function SettingsApp() {
  const [info, setInfo] = useState<Settings | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);

  async function loadAuth() {
    try {
      setAuth(await authApi.status());
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    settingsApi.get().then(setInfo).catch(() => {});
    loadAuth();
  }, []);

  return (
    <AppShell title="Settings" subtitle="Gateway info & dashboard security">
      <Section title="Cloud sync">
        <CloudSyncCard />
      </Section>

      <Section title="Dashboard password">
        <PasswordCard auth={auth} reload={loadAuth} />
      </Section>

      <Section title="Report a bug">
        <BugReportCard />
      </Section>

      <Section title="Gateway">
        <div className="space-y-1 text-[11px]">
          <Row k="Version" v={info ? `enx ${info.version}` : "…"} />
          <Row k="Address" v={info ? `${info.host}:${info.port}` : "…"} />
          <Row k="Runtime dir" v={info?.runtime_dir ?? "…"} mono />
        </div>
      </Section>
    </AppShell>
  );
}

// BugReportCard lets a signed-in user file a bug with a title, description, and
// screenshots (file pick or paste). Each image uploads to R2 via imageApi.
function BugReportCard() {
  const profile = useProfile();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [shots, setShots] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  if (!profile.loggedIn) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-[11px] leading-relaxed text-white/55">
        Sign in with Discord in the <span className="text-white/80">Profile</span> app to report a bug.
      </div>
    );
  }

  const addImage = async (file: File) => {
    if (shots.length >= 6) { setErr("Up to 6 screenshots."); return; }
    setUploading(true); setErr("");
    try {
      const r = await imageApi.upload(file);
      setShots((s) => [...s, r.url]);
    } catch {
      setErr("Couldn't upload that image.");
    } finally { setUploading(false); }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    const f = item?.getAsFile();
    if (f) { e.preventDefault(); addImage(f); }
  };

  const submit = async () => {
    if (!title.trim()) { setErr("Please add a title."); return; }
    setBusy(true); setErr("");
    try {
      await bugApi.report({ title: title.trim(), body: body.trim(), shots });
      setTitle(""); setBody(""); setShots([]);
      setDone(true); setTimeout(() => setDone(false), 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "couldn't send");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What went wrong?" className="w-full rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-white/25" />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} onPaste={onPaste} placeholder="Describe the steps to reproduce… (you can paste a screenshot here)" rows={3} className="w-full resize-y rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-white outline-none focus:border-white/25" />

      {shots.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {shots.map((url, i) => (
            <div key={url} className="group relative">
              <img src={url} alt="" className="h-16 w-16 rounded-md border border-white/10 object-cover" />
              <button onClick={() => setShots((s) => s.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 rounded-full bg-black/70 p-0.5 text-white/70 hover:text-white"><X className="h-3 w-3" /></button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-white/60 hover:bg-white/5 hover:text-white">
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />} Screenshot
          <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) addImage(f); e.target.value = ""; }} />
        </label>
        <button onClick={submit} disabled={busy || !title.trim()} className="ml-auto flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black hover:opacity-90 disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : done ? <Check className="h-3.5 w-3.5" /> : <Bug className="h-3.5 w-3.5" />} {done ? "Sent — thanks!" : "Send report"}
        </button>
      </div>
      {err && <p className="text-[11px] text-red-300">{err}</p>}
    </div>
  );
}

// CloudSyncCard configures how cloud sync behaves: the global automatic-sync
// toggle, status, and a manual "Sync now". Identity (login / sign out / role)
// lives in the Profile app. Login-gated — it points to Profile when signed out.
// The dashboard password and session are never synced. Playlists sync for
// everyone; providers/accounts/keys/aliases sync with a subscription
// (cloud.sync.full) — credentials are encrypted before upload.
function CloudSyncCard() {
  const profile = useProfile();
  const full = profile.has("cloud.sync.full"); // full sync is a Premium perk
  const [busy, setBusy] = useState("");
  const [synced, setSynced] = useState("");
  const [error, setError] = useState("");

  if (profile.loading) return <div className="h-10 animate-pulse rounded-lg bg-white/5" />;

  if (!profile.loggedIn) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-[11px] leading-relaxed text-white/55">
        Sign in with Discord in the <span className="text-white/80">Profile</span> app to sync your playlists across
        devices.
      </div>
    );
  }

  async function toggleAuto() {
    setError("");
    setBusy("toggle");
    try {
      await profile.setAutoSync(!profile.autoSync);
    } catch (e) {
      setError(e instanceof Error ? e.message : "couldn't update");
    } finally {
      setBusy("");
    }
  }

  async function syncNow() {
    setError("");
    setSynced("");
    setBusy("sync");
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-medium text-white">
            <Cloud className="h-3.5 w-3.5 text-white/50" /> Automatic sync
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-white/45">
            Push changes automatically and pull updates from your other devices.
          </p>
        </div>
        <Tooltip label={!full ? "Premium only" : profile.autoSync ? "Turn off automatic sync" : "Turn on automatic sync"} place="bottom">
          <button
            onClick={toggleAuto}
            disabled={!!busy || !full}
            role="switch"
            aria-checked={profile.autoSync && full}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              profile.autoSync && full ? "bg-emerald-500/80" : "bg-white/15"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                profile.autoSync && full ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </Tooltip>
      </div>

      <div className="flex items-center gap-2">
        <Tooltip label={!full ? "Premium only" : "Reconcile with the cloud now"} place="bottom">
          <button
            onClick={syncNow}
            disabled={!!busy || !full}
            className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === "sync" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sync now
          </button>
        </Tooltip>
        {synced && (
          <span className="flex items-center gap-1 text-[11px] text-emerald-300">
            <Check className="h-3 w-3" /> {synced}
          </span>
        )}
        {error && <span className="text-[11px] text-red-300">{error}</span>}
      </div>

      <p className="text-[11px] leading-relaxed text-white/40">
        {full
          ? "Full sync is on: your providers, accounts, gateway keys and aliases sync too — credentials are encrypted before they leave this device."
          : "Playlists sync automatically on every plan. Upgrade to Premium in the Profile app to sync your providers, accounts, keys and aliases."}
      </p>
    </div>
  );
}

function PasswordCard({ auth, reload }: { auth: AuthStatus | null; reload: () => void }) {
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!auth) return <div className="h-10 animate-pulse rounded-lg bg-white/5" />;

  async function setOrChange() {
    const fields = auth!.password_set
      ? [
          { name: "current", label: "Current password", type: "password" as const },
          { name: "next", label: "New password", type: "password" as const },
        ]
      : [{ name: "next", label: "New password", type: "password" as const }];
    const res = await dialog.form({
      title: auth!.password_set ? "Change password" : "Set password",
      message: "Protects remote access to the dashboard, terminal, and files.",
      fields,
      confirmLabel: "Save",
    });
    if (!res) return;
    if ((res.next ?? "").length < 6) {
      await dialog.alert({ title: "Too short", message: "Password must be at least 6 characters." });
      return;
    }
    setBusy(true);
    try {
      if (auth!.password_set) await authApi.change(res.current ?? "", res.next);
      else await authApi.setup(res.next);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
      reload();
    } catch (e) {
      await dialog.alert({ title: "Failed", message: e instanceof Error ? e.message : "could not save" });
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    const ok = await dialog.confirm({ title: "Log out?", message: "You'll need the password to access remotely again.", confirmLabel: "Log out" });
    if (!ok) return;
    await authApi.logout();
    // Reload so a remote session returns to the login screen.
    location.reload();
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
      <p className="text-[11px] leading-relaxed text-white/55">
        {auth.password_set
          ? "A dashboard password is set. Localhost is trusted without it; remote access requires logging in."
          : "No password yet. Set one to allow remote access to the dashboard, terminal, and files."}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <Tooltip label={auth.password_set ? "Change the password" : "Set a password"} place="bottom">
          <button
            onClick={setOrChange}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/15 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : done ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Lock className="h-3.5 w-3.5" />}
            {auth.password_set ? "Change password" : "Set password"}
          </button>
        </Tooltip>
        {auth.password_set && auth.logged_in && (
          <Tooltip label="End this session" place="bottom">
            <button onClick={logout} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/60 hover:bg-white/5 hover:text-white">
              <LogOut className="h-3.5 w-3.5" /> Log out
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">{title}</h2>
      {children}
    </section>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-1.5">
      <span className="text-white/40">{k}</span>
      <span className={`truncate ${mono ? "font-mono" : ""} text-white/70`}>{v}</span>
    </div>
  );
}
