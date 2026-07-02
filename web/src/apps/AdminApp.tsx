import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Loader2, Users, Copy, ScrollText, BarChart3, ShieldCheck, ShieldOff, Search, MoreHorizontal, Ban, VolumeX, AlertTriangle, Plus, Minus, Boxes, Trash2, Pencil, RefreshCw, Ticket, Mail, Send } from "lucide-react";
import { openProfile } from "../os/profileViewer";
import { useAdminEvents } from "../os/adminBus";
import { useDialog } from "../os/dialog";
import { FileSearch, X, Store, Check, Puzzle, ShoppingBag } from "lucide-react";
import { Tooltip } from "../components/Tooltip";
import { adminApi, modApi, searchApi, adminVipApi, couponAdminApi, inboxAdminApi, subscriptionApi, type FlaggedLink, type ModAction, type AdminStats, type ProviderModel, type PluginReview, type PluginReviewDetail, type AdminMarketPlugin, type VIPProduct, type VIPService, type Coupon, type InboxMessage, type InboxRole, type UserHit } from "../lib/api";

type Tab = "stats" | "flags" | "users" | "models" | "market" | "store" | "scan" | "reviews" | "log" | "coupons" | "inbox";

// AdminApp is the moderator-only Admin Tools app. It only appears in the dock
// for moderators (see apps registry), and every endpoint it calls is role-gated
// server-side — the client gating is only for UX.
export function AdminApp() {
  const [tab, setTab] = useState<Tab>("stats");
  // Overview on top; the admin tools grouped below.
  const overview = { id: "stats" as Tab, label: "Overview", icon: BarChart3 };
  const tools: { id: Tab; label: string; icon: typeof Users }[] = [
    { id: "flags", label: "Duplicates", icon: Copy },
    { id: "users", label: "Users", icon: Users },
    { id: "models", label: "Models", icon: Boxes },
    { id: "market", label: "Plugins", icon: Store },
    { id: "store", label: "Official Store", icon: ShoppingBag },
    { id: "scan", label: "Plugin scan", icon: ShieldCheck },
    { id: "reviews", label: "Review log", icon: FileSearch },
    { id: "coupons", label: "Coupons", icon: Ticket },
    { id: "inbox", label: "Inbox", icon: Mail },
    { id: "log", label: "Mod log", icon: ScrollText },
  ];
  const NavBtn = ({ t }: { t: { id: Tab; label: string; icon: typeof Users } }) => {
    const Icon = t.icon;
    const on = tab === t.id;
    return (
      <button
        onClick={() => setTab(t.id)}
        title={t.label}
        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors ${
          on ? "bg-white/12 text-white" : "text-white/45 hover:bg-white/5 hover:text-white/80"
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{t.label}</span>
      </button>
    );
  };
  return (
    <div className="flex h-full">
      {/* Icon sidebar: Overview up top, tools below. */}
      <div className="flex w-40 shrink-0 flex-col gap-1 border-r border-white/10 p-2">
        <div className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-white/30">Admin</div>
        <NavBtn t={overview} />
        <div className="mx-2 my-1.5 border-t border-white/5" />
        <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-white/30">Tools</div>
        {tools.map((t) => <NavBtn key={t.id} t={t} />)}
      </div>
      {/* Content */}
      <div className="min-w-0 flex-1 overflow-auto p-4">
        {tab === "stats" && <StatsTab />}
        {tab === "flags" && <FlagsTab />}
        {tab === "users" && <UsersTab />}
        {tab === "models" && <ModelsTab />}
        {tab === "market" && <MarketplaceTab />}
        {tab === "store" && <OfficialStoreTab />}
        {tab === "scan" && <PluginScanTab />}
        {tab === "reviews" && <ReviewLogTab />}
        {tab === "coupons" && <CouponsTab />}
        {tab === "inbox" && <InboxTab />}
        {tab === "log" && <LogTab />}
      </div>
    </div>
  );
}

function StatsTab() {
  const [s, setS] = useState<AdminStats | null>(null);
  const [flags, setFlags] = useState<FlaggedLink[] | null>(null);
  const [actions, setActions] = useState<ModAction[] | null>(null);
  const load = useCallback(() => {
    adminApi.stats().then(setS).catch(() => setS(null));
    adminApi.flags().then((r) => setFlags(r.links ?? [])).catch(() => setFlags([]));
    adminApi.log().then((r) => setActions(r.actions ?? [])).catch(() => setActions([]));
  }, []);
  useEffect(() => load(), [load]);
  useAdminEvents(load);

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Overview</h2>
          <button onClick={load} title="Refresh" className="rounded-lg border border-white/10 p-1.5 text-white/40 hover:bg-white/5 hover:text-white"><RefreshCw className="h-3.5 w-3.5" /></button>
        </div>
        {!s ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-white/5" />)}</div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard icon={<Users className="h-4 w-4" />} label="Users" value={s.users} accent="text-sky-300" />
            <StatCard icon={<ShieldCheck className="h-4 w-4" />} label="Moderators" value={s.moderators} accent="text-emerald-300" />
            <StatCard icon={<ScrollText className="h-4 w-4" />} label="Messages" value={s.messages} accent="text-violet-300" />
            <StatCard icon={<BarChart3 className="h-4 w-4" />} label="Posts" value={s.posts} accent="text-fuchsia-300" />
          </div>
        )}
      </div>

      {/* Attention: open duplicate flags */}
      <div>
        <h3 className="mb-1.5 text-xs font-semibold text-white/70">Needs attention</h3>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          {flags === null ? (
            <div className="h-6 animate-pulse rounded bg-white/5" />
          ) : flags.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-white/45"><ShieldCheck className="h-4 w-4 text-emerald-400/70" /> No open duplicate-account flags.</div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-amber-200/90"><AlertTriangle className="h-4 w-4" /> {flags.length} duplicate-account {flags.length === 1 ? "flag" : "flags"} awaiting review — see the Duplicates tab.</div>
          )}
        </div>
      </div>

      {/* Recent moderator activity */}
      <div>
        <h3 className="mb-1.5 text-xs font-semibold text-white/70">Recent activity</h3>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-1.5">
          {actions === null ? (
            <div className="h-6 animate-pulse rounded bg-white/5" />
          ) : actions.length === 0 ? (
            <div className="px-2 py-2 text-xs text-white/40">No moderator actions yet.</div>
          ) : (
            <div className="divide-y divide-white/5">
              {actions.slice(0, 6).map((a, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1.5 text-[11px]">
                  <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-white/70">{a.action}</span>
                  <span className="truncate text-white/50">{a.actor_display || a.actor_name} → {a.target}</span>
                  <span className="ml-auto shrink-0 text-white/30">{a.created_at}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, accent }: { icon: ReactNode; label: string; value: number; accent: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className={`mb-1 ${accent}`}>{icon}</div>
      <div className="text-xl font-semibold text-white">{value.toLocaleString()}</div>
      <div className="text-[11px] text-white/45">{label}</div>
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

// PluginScanTab configures the external AI security review for plugin publishing.
function PluginScanTab() {
  const [s, setS] = useState<{ ai_review_endpoint: string; ai_review_model: string; ai_review_enabled: boolean; has_key: boolean } | null>(null);
  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    adminApi.pluginScan().then((r) => {
      setS(r);
      setEndpoint(r.ai_review_endpoint || "");
      setModel(r.ai_review_model || "");
      setEnabled(r.ai_review_enabled);
    }).catch(() => setS(null));
  }, []);
  useEffect(() => load(), [load]);

  const save = async () => {
    setSaving(true);
    setMsg("");
    try {
      await adminApi.savePluginScan({
        ai_review_endpoint: endpoint.trim(),
        ai_review_model: model.trim(),
        ai_review_enabled: enabled,
        ...(key.trim() ? { ai_review_api_key: key.trim() } : {}),
      });
      setKey("");
      setMsg("Saved.");
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!s) return <div className="h-32 animate-pulse rounded-lg bg-white/5" />;
  return (
    <div className="max-w-xl space-y-3">
      <p className="text-xs text-white/50">
        Plugins uploaded to the marketplace are always scanned by static heuristics (obfuscation/encryption/binaries are rejected). Optionally add an AI reviewer (OpenAI-compatible chat endpoint) for deeper analysis (RAT/backdoor/exfiltration).
      </p>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-white/70">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-indigo-500" /> Enable AI review
      </label>
      <div>
        <label className="mb-1 block text-[11px] text-white/50">Endpoint (chat completions base URL)</label>
        <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://api.openai.com/v1" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/25" />
      </div>
      <div>
        <label className="mb-1 block text-[11px] text-white/50">Model</label>
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o-mini" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/25" />
      </div>
      <div>
        <label className="mb-1 block text-[11px] text-white/50">API key {s.has_key && <span className="text-emerald-300">(set — leave blank to keep)</span>}</label>
        <input value={key} onChange={(e) => setKey(e.target.value)} type="password" placeholder={s.has_key ? "••••••••" : "sk-…"} className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/25" />
      </div>
      {msg && <div className="text-xs text-white/60">{msg}</div>}
      <button onClick={save} disabled={saving} className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:opacity-90 disabled:opacity-50">{saving ? "Saving…" : "Save settings"}</button>
    </div>
  );
}

// ReviewLogTab shows every plugin publish attempt + verdict; clicking one opens
// the scanned source so a moderator can audit what was approved/rejected.
function ReviewLogTab() {
  const [items, setItems] = useState<PluginReview[] | null>(null);
  const [filter, setFilter] = useState<"" | "approved" | "rejected">("");
  const [detail, setDetail] = useState<PluginReviewDetail | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback((v: string) => {
    adminApi.pluginReviews(v).then((r) => { setItems(r.reviews ?? []); setErr(""); }).catch((e) => setErr(e instanceof Error ? e.message : "failed"));
  }, []);
  useEffect(() => load(filter), [load, filter]);

  const open = async (id: number) => {
    try { setDetail(await adminApi.pluginReview(id)); } catch { /* ignore */ }
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-1">
        {(["", "approved", "rejected"] as const).map((v) => (
          <button key={v || "all"} onClick={() => setFilter(v)} className={`rounded-lg px-2.5 py-1 text-xs ${filter === v ? "bg-white/12 text-white" : "text-white/45 hover:text-white/80"}`}>
            {v === "" ? "All" : v === "approved" ? "Approved" : "Rejected"}
          </button>
        ))}
      </div>
      {err && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{err}</div>}
      {!items ? (
        <div className="h-10 animate-pulse rounded-lg bg-white/5" />
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-white/40">No reviews yet.</div>
      ) : (
        <div className="space-y-1.5">
          {items.map((r) => (
            <button key={r.id} onClick={() => open(r.id)} className="flex w-full items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] p-2.5 text-left hover:bg-white/[0.05]">
              <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${r.verdict === "approved" ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"}`}>{r.verdict}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-medium text-white">{r.name}</span>
                  <span className="rounded bg-white/10 px-1 text-[9px] uppercase text-white/50">{r.runtime}</span>
                  <span className="rounded bg-white/5 px-1 text-[9px] text-white/40">{r.scan_stage}</span>
                </div>
                {r.reason && <div className="mt-0.5 truncate text-[11px] text-red-300/80">{r.reason}</div>}
                <div className="mt-0.5 text-[10px] text-white/30">by {r.display_name || r.username} · {r.created_at}</div>
              </div>
              <FileSearch className="h-3.5 w-3.5 shrink-0 text-white/30" />
            </button>
          ))}
        </div>
      )}
      {detail && <ReviewDetailModal r={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function ReviewDetailModal({ r, onClose }: { r: PluginReviewDetail; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex h-[85%] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#11131a] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
          <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${r.verdict === "approved" ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"}`}>{r.verdict}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white">{r.name}</div>
            <div className="truncate text-[10px] text-white/40">{r.slug} · {r.runtime} · {r.scan_stage} · by {r.display_name || r.username}</div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        {r.reason && <div className="border-b border-white/5 bg-red-500/[0.06] px-4 py-2 text-xs text-red-300">Reason: {r.reason}</div>}
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
          {(r.sources ?? []).length === 0 ? (
            <div className="text-xs text-white/40">No source snapshot captured.</div>
          ) : (
            r.sources.map((f, i) => (
              <div key={i} className="overflow-hidden rounded-lg border border-white/10">
                <div className="border-b border-white/5 bg-white/[0.03] px-3 py-1.5 font-mono text-[11px] text-white/60">{f.path}</div>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[10px] leading-relaxed text-white/75">{f.content}</pre>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// MarketplaceTab moderates published/pending/rejected plugins: view full source,
// approve (incl. a rejected false positive), reject, or take down.
function MarketplaceTab() {
  const [items, setItems] = useState<AdminMarketPlugin[] | null>(null);
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "">("pending");
  const [busy, setBusy] = useState(0);
  const [source, setSource] = useState<{ name: string; sources: { path: string; content: string }[] } | null>(null);
  const [err, setErr] = useState("");
  const dialog = useDialog();

  const load = useCallback((s: string) => {
    adminApi.marketPlugins(s).then((r) => { setItems(r.plugins ?? []); setErr(""); }).catch((e) => setErr(e instanceof Error ? e.message : "failed"));
  }, []);
  useEffect(() => load(status), [load, status]);

  const act = async (fn: () => Promise<unknown>, id: number) => {
    setBusy(id); setErr("");
    try { await fn(); load(status); } catch (e) { setErr(e instanceof Error ? e.message : "action failed"); } finally { setBusy(0); }
  };

  const approve = (p: AdminMarketPlugin) => act(() => adminApi.marketApprove(p.id), p.id);
  const reject = async (p: AdminMarketPlugin) => {
    const reason = await dialog.prompt({ title: `Reject ${p.name}?`, message: "Reason (shown to the author):", placeholder: "e.g. contains data exfiltration" });
    if (reason) act(() => adminApi.marketReject(p.id, reason), p.id);
  };
  const takedown = async (p: AdminMarketPlugin) => {
    const ok = await dialog.confirm({ title: `Take down ${p.name}?`, message: "Removes it from the marketplace and deletes its bundle.", confirmLabel: "Take down", danger: true });
    if (ok) act(() => adminApi.marketTakedown(p.id), p.id);
  };
  const viewSource = async (p: AdminMarketPlugin) => {
    try { const r = await adminApi.marketSource(p.id); setSource({ name: r.name, sources: r.sources ?? [] }); }
    catch (e) { setErr(e instanceof Error ? e.message : "could not load source"); }
  };

  const badge = (s: string) => s === "approved" ? "bg-emerald-500/20 text-emerald-300" : s === "rejected" ? "bg-red-500/20 text-red-300" : "bg-amber-500/20 text-amber-300";

  return (
    <div>
      <div className="mb-3 flex items-center gap-1">
        {(["pending", "approved", "rejected", ""] as const).map((s) => (
          <button key={s || "all"} onClick={() => setStatus(s)} className={`rounded-lg px-2.5 py-1 text-xs ${status === s ? "bg-white/12 text-white" : "text-white/45 hover:text-white/80"}`}>
            {s === "" ? "All" : s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {err && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{err}</div>}
      {!items ? (
        <div className="h-10 animate-pulse rounded-lg bg-white/5" />
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-white/40">No {status || ""} plugins.</div>
      ) : (
        <div className="space-y-2">
          {items.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/5 text-white/60">
                {p.icon_url ? <img src={p.icon_url} alt="" className="h-full w-full object-cover" /> : <Puzzle className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-white">{p.name}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${badge(p.status)}`}>{p.status}</span>
                  <span className="rounded bg-white/10 px-1 text-[9px] uppercase text-white/50">{p.runtime}</span>
                </div>
                {p.review_reason && <div className="mt-0.5 truncate text-[11px] text-white/50">{p.review_reason}</div>}
                <div className="mt-0.5 text-[10px] text-white/30">by {p.display_name || p.username} · {p.install_count} installs</div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Tooltip label="View full source"><button onClick={() => viewSource(p)} className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-white/55 hover:bg-white/10 hover:text-white"><FileSearch className="h-3.5 w-3.5" /></button></Tooltip>
                {p.status !== "approved" && <Tooltip label="Approve"><button onClick={() => approve(p)} disabled={busy === p.id} className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-1.5 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"><Check className="h-3.5 w-3.5" /></button></Tooltip>}
                {p.status !== "rejected" && <Tooltip label="Reject"><button onClick={() => reject(p)} disabled={busy === p.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-white/55 hover:bg-red-500/20 hover:text-red-200 disabled:opacity-40"><Ban className="h-3.5 w-3.5" /></button></Tooltip>}
                <Tooltip label="Take down"><button onClick={() => takedown(p)} disabled={busy === p.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-white/55 hover:bg-red-500/30 hover:text-red-200 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /></button></Tooltip>
              </div>
            </div>
          ))}
        </div>
      )}
      {source && <SourceModal name={source.name} sources={source.sources} onClose={() => setSource(null)} />}
    </div>
  );
}

function SourceModal({ name, sources, onClose }: { name: string; sources: { path: string; content: string }[]; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex h-[85%] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#11131a] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
          <FileSearch className="h-4 w-4 text-white/50" />
          <div className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{name} — full source ({sources.length} files)</div>
          <button onClick={onClose} className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
          {sources.length === 0 ? (
            <div className="text-xs text-white/40">No source files (binary or empty bundle).</div>
          ) : sources.map((f, i) => (
            <div key={i} className="overflow-hidden rounded-lg border border-white/10">
              <div className="border-b border-white/5 bg-white/[0.03] px-3 py-1.5 font-mono text-[11px] text-white/60">{f.path}</div>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[10px] leading-relaxed text-white/75">{f.content}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// OfficialStoreTab curates VIP products: shows balance, browses the live catalog,
// and manages the sellable list with markup.
function OfficialStoreTab() {
  const [balance, setBalance] = useState<number | null>(null);
  const [products, setProducts] = useState<VIPProduct[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");
  const dialog = useDialog();

  const load = useCallback(() => {
    adminVipApi.balance().then((r) => setBalance(r.balance)).catch(() => setBalance(null));
    adminVipApi.products().then((r) => setProducts(r.products ?? [])).catch((e) => { setErr(e instanceof Error ? e.message : "failed"); setProducts([]); });
  }, []);
  useEffect(() => load(), [load]);

  const toggle = async (p: VIPProduct) => { try { await adminVipApi.toggle(p.id, !p.enabled); load(); } catch { /* ignore */ } };
  const remove = async (p: VIPProduct) => {
    const ok = await dialog.confirm({ title: `Remove ${p.name}?`, message: "It will disappear from the store.", confirmLabel: "Remove", danger: true });
    if (ok) { try { await adminVipApi.remove(p.id); load(); } catch { /* ignore */ } }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-white/60">VIP balance: <span className="font-semibold text-emerald-300">{balance === null ? "—" : "Rp " + balance.toLocaleString("id-ID")}</span></div>
        <div className="flex gap-1.5">
          <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black hover:opacity-90"><Plus className="h-3.5 w-3.5" /> Add product</button>
          <button onClick={load} className="rounded-lg border border-white/10 p-1.5 text-white/40 hover:bg-white/5 hover:text-white"><RefreshCw className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      {err && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{err}</div>}
      {!products ? (
        <div className="h-10 animate-pulse rounded-lg bg-white/5" />
      ) : products.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-white/40">No products curated yet. Add one from the VIP catalog.</div>
      ) : (
        <div className="space-y-1.5">
          {products.map((p) => {
            const sell = Math.ceil(p.cost_price * (1 + p.markup_percent / 100)) + p.markup_flat;
            return (
              <div key={p.id} className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] p-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-white">{p.name}</span>
                    <span className="rounded bg-white/10 px-1 text-[9px] uppercase text-white/50">{p.kind}</span>
                    {p.needs_zone && <span className="rounded bg-amber-500/20 px-1 text-[9px] text-amber-300">zone</span>}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-white/35">{p.service_code} · cost {p.cost_price.toLocaleString("id-ID")} → sell {sell.toLocaleString("id-ID")} (+{p.markup_percent}%{p.markup_flat ? ` +${p.markup_flat}` : ""})</div>
                </div>
                <button onClick={() => toggle(p)} className={`rounded-lg border px-2 py-1 text-[10px] ${p.enabled ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-white/10 text-white/40"}`}>{p.enabled ? "Enabled" : "Off"}</button>
                <button onClick={() => remove(p)} className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-white/55 hover:bg-red-500/30 hover:text-red-200"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            );
          })}
        </div>
      )}
      {adding && <AddProductModal onClose={() => setAdding(false)} onAdded={() => { setAdding(false); load(); }} />}
    </div>
  );
}

function AddProductModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [kind, setKind] = useState<"prepaid" | "game">("prepaid");
  const [services, setServices] = useState<VIPService[] | null>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<VIPService | null>(null);
  const [markupPct, setMarkupPct] = useState("5");
  const [markupFlat, setMarkupFlat] = useState("0");
  const [needsZone, setNeedsZone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(() => { setServices(null); adminVipApi.catalog(kind).then((r) => setServices(r.services ?? [])).catch((e) => { setErr(e instanceof Error ? e.message : "failed"); setServices([]); }); }, [kind]);
  useEffect(() => load(), [load]);

  const filtered = (services ?? []).filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()) || s.code.toLowerCase().includes(q.toLowerCase()) || (s.brand || "").toLowerCase().includes(q.toLowerCase())).slice(0, 100);

  const add = async () => {
    if (!picked) return;
    setSaving(true); setErr("");
    try {
      await adminVipApi.upsert({
        kind, service_code: picked.code, name: picked.name, brand: picked.brand || "", category: picked.type || "other",
        cost_price: picked.price, markup_percent: parseFloat(markupPct) || 0, markup_flat: parseInt(markupFlat || "0", 10) || 0,
        needs_zone: kind === "game" ? needsZone : false, enabled: true, sort_order: 0,
      });
      onAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex h-[85%] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#11131a] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
          <div className="flex-1 text-sm font-semibold text-white">Add product from VIP catalog</div>
          <button onClick={onClose} className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="border-b border-white/5 p-3">
          <div className="mb-2 flex gap-1">
            <button onClick={() => setKind("prepaid")} className={`rounded-lg px-2.5 py-1 text-xs ${kind === "prepaid" ? "bg-white/12 text-white" : "text-white/45"}`}>Prepaid</button>
            <button onClick={() => setKind("game")} className={`rounded-lg px-2.5 py-1 text-xs ${kind === "game" ? "bg-white/12 text-white" : "text-white/45"}`}>Game/Streaming</button>
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search catalog…" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/25" />
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {!services ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-white/40" /></div> : filtered.map((s) => (
            <button key={s.code} onClick={() => setPicked(s)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs ${picked?.code === s.code ? "bg-indigo-500/20 text-white" : "text-white/70 hover:bg-white/5"}`}>
              <div className="min-w-0 flex-1"><div className="truncate">{s.name}</div><div className="font-mono text-[9px] text-white/35">{s.code} · {s.brand}</div></div>
              <span className="shrink-0 text-emerald-300">Rp {s.price.toLocaleString("id-ID")}</span>
              {s.status && s.status !== "available" && <span className="shrink-0 rounded bg-red-500/20 px-1 text-[9px] text-red-300">{s.status}</span>}
            </button>
          ))}
        </div>
        {picked && (
          <div className="border-t border-white/5 p-3">
            <div className="mb-2 text-xs text-white/60">Selected: <span className="text-white">{picked.name}</span> (cost Rp {picked.price.toLocaleString("id-ID")})</div>
            <div className="flex items-end gap-2">
              <label className="flex-1 text-[11px] text-white/50">Markup %<input value={markupPct} onChange={(e) => setMarkupPct(e.target.value.replace(/[^\d.]/g, ""))} className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white outline-none" /></label>
              <label className="flex-1 text-[11px] text-white/50">Markup flat (Rp)<input value={markupFlat} onChange={(e) => setMarkupFlat(e.target.value.replace(/\D/g, ""))} className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white outline-none" /></label>
              {kind === "game" && <label className="flex items-center gap-1 text-[11px] text-white/50"><input type="checkbox" checked={needsZone} onChange={(e) => setNeedsZone(e.target.checked)} className="accent-indigo-500" /> needs zone</label>}
            </div>
            <div className="mt-1 text-[11px] text-white/40">Sell: Rp {(Math.ceil(picked.price * (1 + (parseFloat(markupPct) || 0) / 100)) + (parseInt(markupFlat || "0", 10) || 0)).toLocaleString("id-ID")}</div>
            {err && <div className="mt-1 text-xs text-red-300">{err}</div>}
            <button onClick={add} disabled={saving} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:opacity-90 disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Add to store</button>
          </div>
        )}
      </div>
    </div>
  );
}

// CouponsTab manages Premium discount coupons.
function CouponsTab() {
  const [rows, setRows] = useState<Coupon[] | null>(null);
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = () => couponAdminApi.list().then((r) => setRows(r.coupons ?? [])).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!code.trim() || !value.trim()) { setErr("Code and value are required."); return; }
    setBusy(true); setErr("");
    try {
      await couponAdminApi.create({
        code: code.trim().toUpperCase(),
        kind,
        value: Number(value),
        max_uses: maxUses.trim() ? Number(maxUses) : null,
      });
      setCode(""); setValue(""); setMaxUses("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally { setBusy(false); }
  };

  const idr = (n: number) => "Rp" + n.toLocaleString("id-ID");

  return (
    <div>
      <h2 className="mb-3 text-sm font-bold text-white">Coupons</h2>
      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase text-white/35">Code</label>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="LAUNCH50" className="w-32 rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white outline-none focus:border-white/25" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase text-white/35">Type</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as "percent" | "amount")} className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white outline-none">
            <option value="percent">Percent %</option>
            <option value="amount">Amount Rp</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase text-white/35">{kind === "percent" ? "Percent (0-100)" : "Amount off"}</label>
          <input value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))} placeholder={kind === "percent" ? "50" : "10000"} className="w-24 rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white outline-none focus:border-white/25" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase text-white/35">Max uses (opt)</label>
          <input value={maxUses} onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, ""))} placeholder="∞" className="w-20 rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white outline-none focus:border-white/25" />
        </div>
        <button onClick={create} disabled={busy} className="flex items-center gap-1 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-black hover:opacity-90 disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Create
        </button>
      </div>
      {err && <div className="mb-3 text-xs text-red-300">{err}</div>}

      {!rows ? (
        <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-white/40" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-center text-xs text-white/40">No coupons yet.</div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs">
              <code className="font-mono font-semibold text-white">{c.code}</code>
              <span className="text-emerald-300">{c.kind === "percent" ? `${c.value}%` : idr(c.value)} off</span>
              <span className="text-white/40">{c.used_count}{c.max_uses ? `/${c.max_uses}` : ""} used</span>
              {!c.active && <span className="rounded bg-white/10 px-1 text-[9px] uppercase text-white/40">inactive</span>}
              <button onClick={() => couponAdminApi.remove(c.id).then(load)} className="ml-auto text-white/30 hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// InboxTab composes admin messages and lists sent ones.
function InboxTab() {
  const [rows, setRows] = useState<InboxMessage[] | null>(null);
  const [roles, setRoles] = useState<InboxRole[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"all" | "role" | "user">("all");
  const [roleTarget, setRoleTarget] = useState("");
  const [userQ, setUserQ] = useState("");
  const [userHits, setUserHits] = useState<UserHit[]>([]);
  const [userPick, setUserPick] = useState<UserHit | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const load = () => inboxAdminApi.list().then((r) => setRows(r.messages ?? [])).catch(() => setRows([]));
  useEffect(() => { load(); inboxAdminApi.roles().then((r) => setRoles(r.roles ?? [])).catch(() => setRoles([])); }, []);

  useEffect(() => {
    if (audience !== "user" || userPick || userQ.trim().length < 2) { setUserHits([]); return; }
    const t = setTimeout(() => subscriptionApi.searchUsers(userQ.trim()).then((r) => setUserHits(r.users ?? [])).catch(() => setUserHits([])), 250);
    return () => clearTimeout(t);
  }, [userQ, audience, userPick]);

  const send = async () => {
    if (!title.trim()) { setErr("Title is required."); return; }
    let target = "";
    if (audience === "role") { if (!roleTarget) { setErr("Pick a role."); return; } target = roleTarget; }
    if (audience === "user") { if (!userPick) { setErr("Pick a user."); return; } target = userPick.id; }
    setBusy(true); setErr(""); setMsg("");
    try {
      await inboxAdminApi.send({ title: title.trim(), body, audience, target });
      setTitle(""); setBody(""); setRoleTarget(""); setUserPick(null); setUserQ("");
      setMsg("Sent.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally { setBusy(false); }
  };

  const audienceLabel = (m: InboxMessage) =>
    m.audience === "all" ? "Everyone" : m.audience === "role" ? `Role: ${roles.find((r) => r.id === m.target)?.name ?? m.target}` : "One user";

  return (
    <div>
      <h2 className="mb-3 text-sm font-bold text-white">Inbox</h2>
      <div className="mb-4 space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="w-full rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-white/25" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message (markdown supported)" rows={4} className="w-full resize-y rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-white outline-none focus:border-white/25" />
        <div className="flex flex-wrap items-center gap-2">
          <select value={audience} onChange={(e) => { setAudience(e.target.value as "all" | "role" | "user"); setUserPick(null); }} className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white outline-none">
            <option value="all">Everyone</option>
            <option value="role">A role</option>
            <option value="user">A specific user</option>
          </select>
          {audience === "role" && (
            <select value={roleTarget} onChange={(e) => setRoleTarget(e.target.value)} className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white outline-none">
              <option value="">Pick a role…</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          {audience === "user" && (
            userPick ? (
              <span className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-xs text-white">
                {userPick.display_name || userPick.username}
                <button onClick={() => { setUserPick(null); setUserQ(""); }} className="text-white/40 hover:text-white"><X className="h-3 w-3" /></button>
              </span>
            ) : (
              <div className="relative">
                <input value={userQ} onChange={(e) => setUserQ(e.target.value)} placeholder="Search user…" className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white outline-none focus:border-white/25" />
                {userHits.length > 0 && (
                  <div className="absolute z-10 mt-1 max-h-40 w-56 overflow-auto rounded-md border border-white/10 bg-[#0e1016] shadow-xl">
                    {userHits.map((h) => (
                      <button key={h.id} onClick={() => { setUserPick(h); setUserHits([]); }} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-white/5">
                        <span className="truncate text-white/80">{h.display_name || h.username}</span>
                        <span className="truncate text-white/30">@{h.username}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          )}
          <button onClick={send} disabled={busy} className="ml-auto flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-black hover:opacity-90 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send
          </button>
        </div>
        {err && <div className="text-[11px] text-red-300">{err}</div>}
        {msg && <div className="text-[11px] text-emerald-300">{msg}</div>}
      </div>

      {!rows ? (
        <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-white/40" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-center text-xs text-white/40">No messages sent yet.</div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-white">{m.title}</div>
                <div className="text-[10px] text-white/40">{audienceLabel(m)} · {m.read_count ?? 0} read</div>
              </div>
              <button onClick={() => inboxAdminApi.remove(m.id).then(load)} className="text-white/30 hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
