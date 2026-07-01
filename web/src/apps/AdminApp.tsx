import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Loader2, Users, Copy, ScrollText, BarChart3, ShieldCheck, ShieldOff, Search, MoreHorizontal, Ban, VolumeX, AlertTriangle, Plus, Minus, Boxes, Trash2, Pencil } from "lucide-react";
import { AppShell } from "./shell";
import { openProfile } from "../os/profileViewer";
import { useAdminEvents } from "../os/adminBus";
import { useDialog } from "../os/dialog";
import { adminApi, modApi, searchApi, type FlaggedLink, type ModAction, type AdminStats, type ProviderModel } from "../lib/api";

type Tab = "stats" | "flags" | "users" | "models" | "log";

// AdminApp is the moderator-only Admin Tools app. It only appears in the dock
// for moderators (see apps registry), and every endpoint it calls is role-gated
// server-side — the client gating is only for UX.
export function AdminApp() {
  const [tab, setTab] = useState<Tab>("stats");
  const tabs: { id: Tab; label: string; icon: typeof Users }[] = [
    { id: "stats", label: "Overview", icon: BarChart3 },
    { id: "flags", label: "Duplicates", icon: Copy },
    { id: "users", label: "Users", icon: Users },
    { id: "models", label: "Models", icon: Boxes },
    { id: "log", label: "Mod log", icon: ScrollText },
  ];
  return (
    <AppShell title="Admin Tools" subtitle="Moderator only">
      <div className="mb-3 flex items-center gap-1">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                tab === t.id ? "bg-white/12 text-white" : "text-white/45 hover:text-white/80"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>
      {tab === "stats" && <StatsTab />}
      {tab === "flags" && <FlagsTab />}
      {tab === "users" && <UsersTab />}
      {tab === "models" && <ModelsTab />}
      {tab === "log" && <LogTab />}
    </AppShell>
  );
}

function StatsTab() {
  const [s, setS] = useState<AdminStats | null>(null);
  const load = useCallback(() => {
    adminApi.stats().then(setS).catch(() => setS(null));
  }, []);
  useEffect(() => load(), [load]);
  useAdminEvents(load);
  if (!s) return <div className="h-20 animate-pulse rounded-lg bg-white/5" />;
  const cards = [
    { label: "Users", value: s.users },
    { label: "Moderators", value: s.moderators },
    { label: "Messages", value: s.messages },
    { label: "Posts", value: s.posts },
    { label: "Open flags", value: s.open_flags },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="text-lg font-semibold text-white">{c.value.toLocaleString()}</div>
          <div className="text-[11px] text-white/45">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

function FlagsTab() {
  const [links, setLinks] = useState<FlaggedLink[] | null>(null);
  const [busy, setBusy] = useState(0);
  const load = useCallback(() => {
    adminApi.flags().then((r) => setLinks(r.links ?? [])).catch(() => setLinks([]));
  }, []);
  useEffect(() => load(), [load]);
  useAdminEvents(load);
  async function review(id: number) {
    setBusy(id);
    try {
      await adminApi.review(id);
      setLinks((l) => (l ? l.filter((x) => x.id !== id) : l));
    } finally {
      setBusy(0);
    }
  }
  if (!links) return <div className="h-10 animate-pulse rounded-lg bg-white/5" />;
  if (links.length === 0)
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-[11px] text-white/50">
        No flagged accounts. Suspected duplicates (shared email or IP) show up here for review.
      </div>
    );
  return (
    <div className="space-y-2">
      {links.map((l) => (
        <div key={l.id} className="flex items-center gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-white/80">
              <button onClick={() => openProfile(l.user_a)} className="hover:underline">{l.name_a}</button>
              <span className="text-white/40"> ↔ </span>
              <button onClick={() => openProfile(l.user_b)} className="hover:underline">{l.name_b}</button>
            </div>
            <div className="mt-0.5 text-[10px] text-white/40">{l.reasons} · score {l.score}</div>
          </div>
          <button onClick={() => review(l.id)} disabled={busy === l.id} className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-white/70 hover:bg-white/5 disabled:opacity-50">
            {busy === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Dismiss"}
          </button>
        </div>
      ))}
    </div>
  );
}

// AdminUserRow is the common shape rendered whether from the default list or a
// search (search hits lack kleos/created_at, which the row doesn't need).
type AdminUserRow = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string;
  is_moderator: boolean;
  is_banned?: boolean;
  muted_until?: string;
};

function UsersTab() {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);

  // Default list (moderators first), shown when the search box is empty.
  const loadDefault = useCallback(() => {
    adminApi.users().then((r) => setUsers(r.users ?? [])).catch(() => setUsers([]));
  }, []);
  useEffect(() => {
    if (q.trim().length < 2) loadDefault();
  }, [q, loadDefault]);
  useAdminEvents(loadDefault);

  async function run(term: string) {
    setQ(term);
    if (term.trim().length < 2) return; // effect reloads the default list
    try {
      const r = await searchApi.query(term.trim());
      setUsers((r.users ?? []).map((u) => ({ ...u, is_moderator: !!u.is_moderator })));
    } catch {
      setUsers([]);
    }
  }
  const patch = (id: string, p: Partial<AdminUserRow>) =>
    setUsers((hs) => (hs ? hs.map((x) => (x.id === id ? { ...x, ...p } : x)) : hs));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">
        <Search className="h-3.5 w-3.5 text-white/40" />
        <input value={q} onChange={(e) => run(e.target.value)} placeholder="Search users by name…" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none" />
      </div>
      {!users && <div className="h-10 animate-pulse rounded-lg bg-white/5" />}
      {users?.map((u) => <UserRow key={u.id} u={u} patch={patch} />)}
      {users?.length === 0 && <div className="text-[11px] text-white/40">{q.trim().length >= 2 ? "No users found." : "No users."}</div>}
    </div>
  );
}

const MUTE_OPTIONS = [
  { label: "10 min", minutes: 10 },
  { label: "1 hour", minutes: 60 },
  { label: "1 day", minutes: 1440 },
  { label: "1 week", minutes: 10080 },
];

// UserRow renders one user with the full moderator action set: make/revoke mod,
// ban/unban, mute (durations)/unmute, warn, and adjust Kleos. Each action is
// role-gated server-side.
function UserRow({ u, patch }: { u: AdminUserRow; patch: (id: string, p: Partial<AdminUserRow>) => void }) {
  const dialog = useDialog();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const muted = !!u.muted_until && new Date(u.muted_until).getTime() > Date.now();

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      dialog.alert({ title: "Action failed", message: e instanceof Error ? e.message : "" });
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }
  const toggleMod = () => act(async () => { const r = await modApi.setModerator(u.id, !u.is_moderator); patch(u.id, { is_moderator: r.is_moderator }); });
  const toggleBan = () => act(async () => { const r = await adminApi.ban(u.id, !u.is_banned); patch(u.id, { is_banned: r.banned }); });
  const mute = (minutes: number) => act(async () => { await adminApi.mute(u.id, minutes); patch(u.id, { muted_until: minutes ? new Date(Date.now() + minutes * 60000).toISOString() : undefined }); });
  const warn = () => act(async () => {
    const msg = await dialog.prompt({ title: "Send warning", message: `to @${u.username}`, placeholder: "Reason for the warning…" });
    if (msg && msg.trim()) await adminApi.warn(u.id, msg.trim());
  });
  const kleos = (delta: number) => act(async () => {
    const raw = await dialog.prompt({ title: `${delta > 0 ? "Add" : "Remove"} Kleos`, message: `for @${u.username}`, defaultValue: "10" });
    const n = parseInt(raw || "0", 10);
    if (n > 0) await adminApi.adjustKleos(u.id, delta * n);
  });

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02]">
      <div className="flex items-center gap-2.5 p-2">
        <button onClick={() => openProfile(u.id)} className="min-w-0 flex flex-1 items-center gap-2.5 text-left">
          {u.avatar_url ? <img src={u.avatar_url} alt="" className="h-8 w-8 rounded-full" /> : <div className="h-8 w-8 rounded-full bg-white/10" />}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 truncate text-sm font-medium text-white">
              {u.display_name || u.username}
              {u.is_moderator && <span className="text-[10px] text-emerald-300">MOD</span>}
              {u.is_banned && <span className="rounded bg-red-500/20 px-1 text-[10px] text-red-300">BANNED</span>}
              {muted && <span className="rounded bg-amber-500/20 px-1 text-[10px] text-amber-300">MUTED</span>}
            </div>
            <div className="truncate text-[11px] text-white/40">@{u.username}</div>
          </div>
        </button>
        <button onClick={() => setOpen((o) => !o)} disabled={busy} className="rounded-lg border border-white/10 p-1.5 text-white/60 hover:bg-white/5 disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
        </button>
      </div>
      {open && (
        <div className="flex flex-wrap gap-1.5 border-t border-white/5 p-2">
          <ActBtn onClick={toggleMod} tone={u.is_moderator ? "red" : "green"} icon={u.is_moderator ? ShieldOff : ShieldCheck}>{u.is_moderator ? "Revoke mod" : "Make mod"}</ActBtn>
          <ActBtn onClick={toggleBan} tone="red" icon={Ban}>{u.is_banned ? "Unban" : "Ban"}</ActBtn>
          {muted ? (
            <ActBtn onClick={() => mute(0)} tone="amber" icon={VolumeX}>Unmute</ActBtn>
          ) : (
            MUTE_OPTIONS.map((m) => <ActBtn key={m.minutes} onClick={() => mute(m.minutes)} tone="amber" icon={VolumeX}>Mute {m.label}</ActBtn>)
          )}
          <ActBtn onClick={warn} tone="neutral" icon={AlertTriangle}>Warn</ActBtn>
          <ActBtn onClick={() => kleos(1)} tone="neutral" icon={Plus}>Kleos</ActBtn>
          <ActBtn onClick={() => kleos(-1)} tone="neutral" icon={Minus}>Kleos</ActBtn>
        </div>
      )}
    </div>
  );
}

function ActBtn({ onClick, tone, icon: Icon, children }: { onClick: () => void; tone: "red" | "green" | "amber" | "neutral"; icon: typeof ShieldCheck; children: ReactNode }) {
  const tones = {
    red: "border-red-400/20 text-red-300 hover:bg-red-400/10",
    green: "border-emerald-400/20 text-emerald-300 hover:bg-emerald-400/10",
    amber: "border-amber-400/20 text-amber-300 hover:bg-amber-400/10",
    neutral: "border-white/10 text-white/70 hover:bg-white/5",
  };
  return (
    <button onClick={onClick} className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] ${tones[tone]}`}>
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

// ModelsTab manages the DB catalog for providers WITHOUT a live /models endpoint
// (fetchable providers resolve live and aren't stored). Only the catalog
// providers are editable here.
const CATALOG_PROVIDERS = ["codebuddy"];

function ModelsTab() {
  const dialog = useDialog();
  const [provider, setProvider] = useState(CATALOG_PROVIDERS[0]);
  const [models, setModels] = useState<ProviderModel[] | null>(null);

  const load = useCallback(() => {
    adminApi.models(provider).then((r) => setModels(r.models ?? [])).catch(() => setModels([]));
  }, [provider]);
  useEffect(() => load(), [load]);

  async function add() {
    const res = await dialog.form({
      title: "Add model",
      fields: [
        { name: "model_id", label: "Model ID", placeholder: "gemini-3.1-pro" },
        { name: "name", label: "Display name", placeholder: "Gemini 3.1 Pro" },
        { name: "type", label: "Type (chat or image)", placeholder: "chat" },
        { name: "owned_by", label: "Owned by", placeholder: "google" },
        { name: "max_input", label: "Max input tokens", placeholder: "200000" },
        { name: "max_output", label: "Max output tokens", placeholder: "64000" },
      ],
      confirmLabel: "Add",
    });
    if (!res || !res.model_id?.trim()) return;
    await adminApi.upsertModel({
      provider, model_id: res.model_id.trim(), name: (res.name || res.model_id).trim(),
      type: res.type?.trim() === "image" ? "image" : "chat",
      owned_by: (res.owned_by || "").trim(), enabled: true, sort_order: (models?.length ?? 0) * 10 + 10,
      max_input: parseInt(res.max_input || "0", 10) || 0, max_output: parseInt(res.max_output || "0", 10) || 0,
    });
    load();
  }
  async function edit(m: ProviderModel) {
    if (!m.id) return;
    const res = await dialog.form({
      title: "Edit model",
      fields: [
        { name: "name", label: "Display name", defaultValue: m.name },
        { name: "type", label: "Type (chat or image)", defaultValue: m.type || "chat" },
        { name: "owned_by", label: "Owned by", defaultValue: m.owned_by || "" },
        { name: "max_input", label: "Max input tokens", defaultValue: String(m.max_input || 0) },
        { name: "max_output", label: "Max output tokens", defaultValue: String(m.max_output || 0) },
      ],
      confirmLabel: "Save",
    });
    if (!res) return;
    await adminApi.updateModel(m.id, {
      ...m, name: (res.name || m.model_id).trim(), type: res.type?.trim() === "image" ? "image" : "chat",
      owned_by: (res.owned_by || "").trim(),
      max_input: parseInt(res.max_input || "0", 10) || 0, max_output: parseInt(res.max_output || "0", 10) || 0,
    });
    load();
  }
  async function toggle(m: ProviderModel) {
    if (!m.id) return;
    await adminApi.updateModel(m.id, { ...m, enabled: !m.enabled });
    load();
  }
  async function remove(m: ProviderModel) {
    if (!m.id) return;
    const ok = await dialog.confirm({ title: `Delete ${m.name}?`, confirmLabel: "Delete" });
    if (ok) { await adminApi.deleteModel(m.id); load(); }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <select value={provider} onChange={(e) => setProvider(e.target.value)} className="rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-white outline-none">
          {CATALOG_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button onClick={add} className="ml-auto flex items-center gap-1 rounded-lg border border-emerald-400/20 px-2.5 py-1.5 text-[11px] text-emerald-300 hover:bg-emerald-400/10"><Plus className="h-3.5 w-3.5" /> Add model</button>
      </div>
      <p className="text-[10px] text-white/35">Only providers without a live model endpoint are edited here. Fetchable providers (kiro, openai-compat) show their models live per account.</p>
      {!models && <div className="h-10 animate-pulse rounded-lg bg-white/5" />}
      {models?.length === 0 && <div className="text-[11px] text-white/40">No models for this provider.</div>}
      {models?.map((m) => {
        const ctx = (n?: number) => (n && n > 0 ? (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`) : null);
        return (
          <div key={m.id ?? m.model_id} className={`flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5 ${m.enabled ? "" : "opacity-50"}`}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5"><span className="truncate text-sm text-white">{m.name}</span>{m.type === "image" && <span className="rounded bg-fuchsia-500/20 px-1 text-[9px] text-fuchsia-300">IMG</span>}</div>
              <div className="flex flex-wrap items-center gap-x-1.5 text-[10px] text-white/35">
                <span className="font-mono">{m.model_id}</span>
                {m.owned_by && <span>· {m.owned_by}</span>}
                {ctx(m.max_input) && <span>· in {ctx(m.max_input)}</span>}
                {ctx(m.max_output) && <span>· out {ctx(m.max_output)}</span>}
                <button onClick={() => navigator.clipboard?.writeText(m.model_id)} title="Copy id" className="text-white/30 hover:text-white"><Copy className="h-3 w-3" /></button>
              </div>
            </div>
            <button onClick={() => edit(m)} className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"><Pencil className="h-3.5 w-3.5" /></button>
            <button onClick={() => toggle(m)} className={`rounded-lg border px-2 py-1 text-[10px] ${m.enabled ? "border-white/10 text-white/60 hover:bg-white/5" : "border-emerald-400/20 text-emerald-300 hover:bg-emerald-400/10"}`}>{m.enabled ? "Disable" : "Enable"}</button>
            <button onClick={() => remove(m)} className="rounded p-1 text-red-400/60 hover:bg-red-500/15 hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        );
      })}
    </div>
  );
}

function LogTab() {
  const [actions, setActions] = useState<ModAction[] | null>(null);
  const load = useCallback(() => {
    adminApi.log().then((r) => setActions(r.actions ?? [])).catch(() => setActions([]));
  }, []);
  useEffect(() => load(), [load]);
  useAdminEvents(load);
  if (!actions) return <div className="h-10 animate-pulse rounded-lg bg-white/5" />;
  if (actions.length === 0) return <div className="text-[11px] text-white/40">No moderation actions yet.</div>;
  return (
    <div className="space-y-1">
      {actions.map((a) => (
        <div key={a.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5 text-[11px]">
          <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/70">{a.action}</span>
          <span className="text-white/60">{a.actor_display || a.actor_name}</span>
          {a.target && <span className="text-white/35">→ {a.target}</span>}
          <span className="ml-auto text-white/30">{new Date(a.created_at).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
