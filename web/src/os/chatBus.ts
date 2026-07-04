import { useEffect, useState } from "react";
import { chatApi, type ChatMessage, type Reaction, type ChatChannel } from "../lib/api";
import { subscribeLive, onStreamStatus } from "./liveBus";

// chatBus is the shared community-chat store: it loads history for the active
// channel, holds the live message list, and keeps a single SSE connection
// (/api/chat/stream) open so new messages arrive in realtime.
let messages: ChatMessage[] = [];
let channels: ChatChannel[] = [];
let channel = "indonesia";
let loading = false;
let loadingOlder = false;
let hasMore = true;
let subscribed = false;
let connected = false;
// firstUnreadId is the id of the first message the user hasn't read for the
// current channel — the "New" divider is drawn above it. Snapshotted on channel
// load so it stays put while the user reads (only reset on the next open).
let firstUnreadId = 0;
const PAGE = 50; // matches the server's chatPageSize
const listeners = new Set<() => void>();

// --- unread tracking (localStorage, per channel) ---
const LAST_READ_KEY = "enowx-chat-lastread";

function lastReadMap(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(LAST_READ_KEY) || "{}");
  } catch {
    return {};
  }
}
function getLastRead(ch: string): number {
  return lastReadMap()[ch] ?? 0;
}
function setLastRead(ch: string, id: number) {
  const m = lastReadMap();
  if ((m[ch] ?? 0) >= id) return;
  m[ch] = id;
  try {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify(m));
  } catch {
    /* quota */
  }
}

// markRead advances the current channel's last-read to the newest message and
// clears the divider (called when the user is at the bottom / channel focused).
export function markRead() {
  if (messages.length === 0) return;
  const newest = messages[messages.length - 1].id;
  setLastRead(channel, newest);
  if (firstUnreadId !== 0) {
    firstUnreadId = 0;
    emit();
  }
}

export function unreadDividerId(): number {
  return firstUnreadId;
}

function emit() {
  listeners.forEach((l) => l());
}

export async function loadChannel(ch?: string) {
  if (ch !== undefined && ch !== channel) {
    channel = ch;
    messages = []; // reset pagination on channel switch
    hasMore = true;
  }
  loading = true;
  emit();
  try {
    const r = await chatApi.list(channel);
    // Server returns newest-first; show oldest-first (newest at the bottom).
    const page = (r.messages ?? []).slice().reverse();
    messages = page;
    hasMore = (r.messages?.length ?? 0) >= PAGE;
    if (r.channels) channels = r.channels;
    // Compute the "New" divider: the first loaded message newer than last-read.
    // Skip if the newest is already read (nothing new) or nothing was read yet.
    const lastRead = getLastRead(channel);
    const newest = page.length ? page[page.length - 1].id : 0;
    if (lastRead > 0 && newest > lastRead) {
      const firstNew = page.find((m) => m.id > lastRead);
      firstUnreadId = firstNew ? firstNew.id : 0;
    } else {
      firstUnreadId = 0;
    }
  } catch {
    /* leave as-is */
  } finally {
    loading = false;
    emit();
  }
}

// loadOlder fetches the page before the oldest loaded message and prepends it.
export async function loadOlderMessages() {
  if (loadingOlder || !hasMore || messages.length === 0) return;
  loadingOlder = true;
  emit();
  try {
    const oldest = messages[0].id;
    const r = await chatApi.list(channel, oldest);
    const older = (r.messages ?? []).slice().reverse();
    if (older.length === 0) {
      hasMore = false;
    } else {
      // De-dupe defensively, then prepend.
      const seen = new Set(messages.map((m) => m.id));
      messages = [...older.filter((m) => !seen.has(m.id)), ...messages];
      hasMore = (r.messages?.length ?? 0) >= PAGE;
    }
  } catch {
    /* ignore */
  } finally {
    loadingOlder = false;
    emit();
  }
}

function ensureStream() {
  if (subscribed) return;
  subscribed = true;
  onStreamStatus((open) => {
    connected = open;
    emit();
  });
  subscribeLive(["chat_message", "message_edited", "message_deleted", "reaction_changed"], (event, data) => {
    if (event === "chat_message" && data) {
      // Only show messages for the channel we're viewing; de-dupe by id.
      if (data.channel && data.channel !== channel) return;
      if (!messages.some((m) => m.id === data.id)) {
        messages = [...messages, data as ChatMessage];
        emit();
      }
    } else if (event === "message_edited" && data) {
      messages = messages.map((m) => (m.id === data.id ? { ...m, content: data.content, edited_at: data.edited_at } : m));
      emit();
    } else if (event === "message_deleted" && data) {
      messages = messages.filter((m) => m.id !== data.id);
      emit();
    } else if (event === "reaction_changed" && data) {
      // Broadcast carries counts; `me` is per-viewer, so preserve our own.
      const incoming: Reaction[] = data.reactions ?? [];
      messages = messages.map((m) => {
        if (m.id !== data.message_id) return m;
        const mine = new Set((m.reactions ?? []).filter((rx) => rx.me).map((rx) => rx.emoji));
        return { ...m, reactions: incoming.map((rx) => ({ ...rx, me: mine.has(rx.emoji) })) };
      });
      emit();
    }
  });
}

export async function sendChat(content: string, replyTo?: number, images?: string[]) {
  const msg = await chatApi.send(content, channel, replyTo, images);
  // Optimistically append (broadcast de-dupes by id).
  if (msg && !messages.some((m) => m.id === msg.id)) {
    messages = [...messages, msg];
    emit();
  }
}

export async function editChat(id: number, content: string) {
  await chatApi.edit(id, content);
  // Apply locally now; the broadcast will reconcile other clients.
  messages = messages.map((m) => (m.id === id ? { ...m, content, edited_at: new Date().toISOString() } : m));
  emit();
}

export async function deleteChat(id: number) {
  await chatApi.remove(id);
  messages = messages.filter((m) => m.id !== id);
  emit();
}

export async function reactChat(id: number, emoji: string) {
  // The response has the canonical aggregate with our own `me` correct.
  const r = await chatApi.react(id, emoji);
  messages = messages.map((m) => (m.id === id ? { ...m, reactions: r.reactions } : m));
  emit();
}


export interface ChatState {
  messages: ChatMessage[];
  channels: ChatChannel[];
  channel: string;
  loading: boolean;
  loadingOlder: boolean;
  hasMore: boolean;
  connected: boolean;
  firstUnreadId: number;
}

let everLoaded = false;

export function useChat(): ChatState {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    if (!everLoaded) {
      everLoaded = true;
      loadChannel();
    }
    ensureStream();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return { messages, channels, channel, loading, loadingOlder, hasMore, connected, firstUnreadId };
}
