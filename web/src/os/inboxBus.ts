import { useEffect, useState } from "react";
import { inboxApi, type InboxMessage } from "../lib/api";
import { subscribeLive } from "./liveBus";

// inboxBus is the shared inbox store: loads admin messages + unread count, and
// bumps on live `inbox` events from the SSE stream (persistence is authoritative).
let items: InboxMessage[] = [];
let unread = 0;
let loaded = false;
let subscribed = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export async function loadInbox() {
  try {
    const r = await inboxApi.list();
    items = r.messages ?? [];
    unread = r.unread ?? 0;
    loaded = true;
  } catch {
    /* ignore */
  }
  emit();
}

// markInboxRead marks one message (id) or all (no id) read + refreshes counts.
export async function markInboxRead(id?: number) {
  if (id) {
    items = items.map((m) => (m.id === id ? { ...m, unread: false } : m));
  } else {
    items = items.map((m) => ({ ...m, unread: false }));
  }
  unread = items.filter((m) => m.unread).length;
  emit();
  await inboxApi.read(id).catch(() => {});
}

function ensureStream() {
  if (subscribed) return;
  subscribed = true;
  subscribeLive(["inbox"], () => loadInbox()); // re-fetch to get the new message
}

export interface InboxState {
  items: InboxMessage[];
  unread: number;
  loaded: boolean;
}

export function useInbox(): InboxState {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    if (!loaded) loadInbox();
    ensureStream();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return { items, unread, loaded };
}
