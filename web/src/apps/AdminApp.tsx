import { useCallback, useEffect, useState } from "react";
import { Loader2, Users, Copy, ScrollText, BarChart3, ShieldCheck, ShieldOff, Search } from "lucide-react";
import { AppShell } from "./shell";
import { openProfile } from "../os/profileViewer";
import { useAdminEvents } from "../os/adminBus";
import { adminApi, modApi, searchApi, type FlaggedLink, type ModAction, type AdminStats, type SearchUserHit } from "../lib/api";

type Tab = "stats" | "flags" | "users" | "log";

// AdminApp is the moderator-only Admin Tools app. It only appears in the dock
// for moderators (see apps registry), and every endpoint it calls is role-gated
// server-side — the client gating is only for UX.
export function AdminApp() {
  const [tab, setTab] = useState<Tab>("stats");
  const tabs: { id: Tab; label: string; icon: typeof Users }[] = [
    { id: "stats", label: "Overview", icon: BarChart3 },
    { id: "flags", label: "Duplicates", icon: Copy },
    { id: "users", label: "Users", icon: Users },
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

function UsersTab() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchUserHit[]>([]);
  const [busy, setBusy] = useState("");

  async function run(term: string) {
    setQ(term);
    if (term.trim().length < 2) {
      setHits([]);
      return;
    }
    try {
      const r = await searchApi.query(term.trim());
      setHits(r.users ?? []);
    } catch {
      setHits([]);
    }
  }
  async function toggleMod(u: SearchUserHit) {
    setBusy(u.id);
    try {
      const r = await modApi.setModerator(u.id, !u.is_moderator);
      setHits((hs) => hs.map((x) => (x.id === u.id ? { ...x, is_moderator: r.is_moderator } : x)));
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">
        <Search className="h-3.5 w-3.5 text-white/40" />
        <input value={q} onChange={(e) => run(e.target.value)} placeholder="Search users by name…" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none" />
      </div>
      {hits.map((u) => (
        <div key={u.id} className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.02] p-2">
          <button onClick={() => openProfile(u.id)} className="min-w-0 flex flex-1 items-center gap-2.5 text-left">
            {u.avatar_url ? <img src={u.avatar_url} alt="" className="h-8 w-8 rounded-full" /> : <div className="h-8 w-8 rounded-full bg-white/10" />}
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-white">{u.display_name || u.username}{u.is_moderator && <span className="ml-1.5 text-[10px] text-emerald-300">MOD</span>}</div>
              <div className="truncate text-[11px] text-white/40">@{u.username}</div>
            </div>
          </button>
          <button onClick={() => toggleMod(u)} disabled={busy === u.id} className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] disabled:opacity-50 ${u.is_moderator ? "border-red-400/20 text-red-300 hover:bg-red-400/10" : "border-emerald-400/20 text-emerald-300 hover:bg-emerald-400/10"}`}>
            {busy === u.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : u.is_moderator ? <ShieldOff className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            {u.is_moderator ? "Revoke" : "Make mod"}
          </button>
        </div>
      ))}
      {q.trim().length >= 2 && hits.length === 0 && <div className="text-[11px] text-white/40">No users found.</div>}
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
