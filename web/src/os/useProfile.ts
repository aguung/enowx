import { useEffect, useState } from "react";
import { syncApi, type SyncStatus, type SyncUser } from "../lib/api";

// Shared profile/account state: the single source of truth for "is the user
// signed in (with Discord), and what plan/roles do they have". Login unlocks
// gated features and enables background sync. Every view reads this store so
// gating + identity stay in sync across the desktop.
let cache: SyncStatus | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export async function refreshProfile() {
  try {
    cache = await syncApi.status();
  } catch {
    cache = cache ?? null;
  }
  loaded = true;
  emit();
}

export interface Profile {
  loading: boolean;
  loggedIn: boolean;
  user: SyncUser | null;
  plan: string; // "free" when not logged in
  refresh: () => Promise<void>;
  startLogin: () => Promise<{ authorize_url: string; state: string }>;
  pollLogin: (state: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

export function useProfile(): Profile {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    if (!loaded) refreshProfile();
    return () => {
      listeners.delete(l);
    };
  }, []);

  const loggedIn = !!(cache?.enabled && cache.user);
  return {
    loading: !loaded,
    loggedIn,
    user: cache?.user ?? null,
    plan: cache?.user?.plan ?? "free",
    refresh: refreshProfile,
    startLogin: () => syncApi.loginStart(),
    pollLogin: async (state: string) => {
      const r = await syncApi.loginPoll(state);
      if (r.done) await refreshProfile();
      return r.done;
    },
    logout: async () => {
      await syncApi.logout();
      await refreshProfile();
    },
  };
}

// hasPlan / capability gate helper. Extend as plans/capabilities are defined.
export function planRank(plan: string): number {
  const order = ["free", "supporter", "pro"];
  const i = order.indexOf(plan);
  return i < 0 ? 0 : i;
}

// gateOk reports whether the current profile satisfies a minimum plan.
export function gateOk(profile: Profile, opts?: { minPlan?: string }): boolean {
  if (!profile.loggedIn) return false;
  if (opts?.minPlan && planRank(profile.plan) < planRank(opts.minPlan)) return false;
  return true;
}
