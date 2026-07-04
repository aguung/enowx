import { useEffect, useState } from "react";
import { notifApi, type Notification } from "../lib/api";
import { subscribeLive } from "./liveBus";

// notifBus is the shared notifications store: loads recent notifications + the
// unread count, and applies live `notification` events from the SSE stream.
let items: Notification[] = [];
let unread = 0;
let loaded = false;
let subscribed = false;
const listeners = new Set<() => void>();

// Banner emitter: a separate channel so a macOS-style banner can pop for any
// incoming notification without coupling to the bell list. Local (non-server)
// events can also raise a banner by calling showBanner directly.
const bannerListeners = new Set<(n: Notification) => void>();
export function onBanner(fn: (n: Notification) => void): () => void {
  bannerListeners.add(fn);
  return () => bannerListeners.delete(fn);
}
export function showBanner(n: Notification) {
  bannerListeners.forEach((l) => l(n));
}

function emit() {
  listeners.forEach((l) => l());
}

export async function loadNotifications() {
  try {
    const r = await notifApi.list();
    items = r.notifications ?? [];
    unread = r.unread ?? 0;
    loaded = true;
  } catch {
    /* ignore */
  }
  emit();
}

export async function markNotificationsRead() {
  unread = 0;
  items = items.map((n) => ({ ...n, read: true }));
  emit();
  await notifApi.markRead().catch(() => {});
}

function ensureStream() {
  if (subscribed) return;
  subscribed = true;
  subscribeLive(["notification"], (_event, data: Notification) => {
    if (!data) return;
    items = [data, ...items].slice(0, 50);
    unread += 1;
    emit();
    showBanner(data); // pop a macOS-style card
  });
}

export interface NotifState {
  items: Notification[];
  unread: number;
}

export function useNotifications(): NotifState {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    if (!loaded) loadNotifications();
    ensureStream();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return { items, unread };
}
