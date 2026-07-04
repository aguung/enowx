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

// Unread badge: separate listener set so the app icon can show a red dot for new
// community messages without depending on the chat view being mounted. Tracks
// the newest message id seen live vs the channel's last-read.
const unreadListeners = new Set<() => void>();
let newestSeenId = 0;
function emitUnread() {
  if (messages.length) newestSeenId = Math.max(newestSeenId, messages[messages.length - 1].id);
  unreadListeners.forEach((l) => l());
}
// hasUnread reports whether the default community channel has messages newer
// than what the user has read. Used to badge the Community app icon.
export function hasUnread(): boolean {
  return newestSeenId > getLastRead(channel);
}
export function subscribeUnread(fn: () => void): () => void {
  unreadListeners.add(fn);
  ensureStream(); // start listening for chat_message even if the chat view is closed
  return () => {
    unreadListeners.delete(fn);
  };
}

// useChatUnread badges the Community app icon. It primes the unread state from
// cache on first use (so a refresh with unread messages still shows the dot)
// and re-renders on any live message or read.
export function useChatUnread(): boolean {
  const [, force] = useState(0);
  useEffect(() => {
    // Seed newestSeenId from cache so the badge survives a refresh without the
    // chat view being opened.
    const cached = getCached(channel);
    if (cached.length) newestSeenId = Math.max(newestSeenId, cached[cached.length - 1].id);
    return subscribeUnread(() => force((n) => n + 1));
  }, []);
  return hasUnread();
}

// --- page cache (localStorage, per channel) ---
// Cache the last loaded page so reopening chat renders instantly instead of
// blocking on a ~half-second fetch every time. The fresh fetch still runs in the
// background and reconciles; the cache just kills the spinner on open.
const CACHE_KEY = "enowx-chat-cache";
const CACHE_MAX = 50; // don't grow localStorage unbounded

function cacheMap(): Record<string, ChatMessage[]> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}
function getCached(ch: string): ChatMessage[] {
  const arr = cacheMap()[ch];
  return Array.isArray(arr) ? arr : [];
}
function setCached(ch: string, msgs: ChatMessage[]) {
  try {
    const m = cacheMap();
    m[ch] = msgs.slice(-CACHE_MAX);
    localStorage.setItem(CACHE_KEY, JSON.stringify(m));
  } catch {
    /* quota — cache is best-effort */
  }
}

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
  // Nothing new to mark → don't emit (avoids a re-render feedback loop when a
  // markRead effect runs repeatedly).
  if (getLastRead(channel) >= newest && firstUnreadId === 0) return;
  setLastRead(channel, newest);
  emitUnread(); // clear the app-icon badge
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
  // Hydrate from cache instantly so the view renders without a spinner. Only
  // show the loading state when there's nothing cached to show.
  const cached = getCached(channel);
  if (cached.length > 0) {
    messages = cached;
    if (cached.length) newestSeenId = Math.max(newestSeenId, cached[cached.length - 1].id);
    computeUnreadDivider();
    loading = false;
  } else {
    loading = true;
  }
  emit();
  try {
    const r = await chatApi.list(channel);
    // Server returns newest-first; show oldest-first (newest at the bottom).
    const page = (r.messages ?? []).slice().reverse();
    messages = page;
    hasMore = (r.messages?.length ?? 0) >= PAGE;
    if (r.channels) channels = r.channels;
    setCached(channel, page);
    if (page.length) newestSeenId = Math.max(newestSeenId, page[page.length - 1].id);
    computeUnreadDivider();
    emitUnread();
  } catch {
    /* keep whatever we have (cache or prior messages) */
  } finally {
    loading = false;
    emit();
  }
}

// computeUnreadDivider positions the "New" divider at the first message newer
// than the channel's last-read (or clears it if everything is read).
function computeUnreadDivider() {
  const lastRead = getLastRead(channel);
  const newest = messages.length ? messages[messages.length - 1].id : 0;
  if (lastRead > 0 && newest > lastRead) {
    const firstNew = messages.find((m) => m.id > lastRead);
    firstUnreadId = firstNew ? firstNew.id : 0;
  } else {
    firstUnreadId = 0;
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
        // Reconcile our own optimistic message (temp id) if this echo is ours.
        const pendingIdx = messages.findIndex((m) => m.pending && m.content === data.content && m.username === data.username);
        if (pendingIdx >= 0) {
          messages = messages.map((m, i) => (i === pendingIdx ? (data as ChatMessage) : m));
        } else {
          messages = [...messages, data as ChatMessage];
        }
        setCached(channel, messages);
        emitUnread();
        emit();
      }
    } else if (event === "message_edited" && data) {
      messages = messages.map((m) => (m.id === data.id ? { ...m, content: data.content, edited_at: data.edited_at } : m));
      setCached(channel, messages);
      emit();
    } else if (event === "message_deleted" && data) {
      messages = messages.filter((m) => m.id !== data.id);
      setCached(channel, messages);
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

// tempId generates negative ids for optimistic messages so they never collide
// with real (positive) server ids and are easy to spot/reconcile.
let tempSeq = -1;

export async function sendChat(
  content: string,
  replyTo?: number,
  images?: string[],
  me?: { username: string; display_name?: string; avatar_url?: string },
  replyPreview?: { author: string; content: string },
) {
  // Optimistic: show the message immediately with a temp id, then reconcile with
  // the server's real message (or mark it failed). The SSE echo also reconciles
  // by matching pending content, whichever arrives first.
  const tmpId = tempSeq--;
  const optimistic: ChatMessage = {
    id: tmpId,
    user_id: "",
    content,
    created_at: new Date().toISOString(),
    username: me?.username ?? "",
    display_name: me?.display_name,
    avatar_url: me?.avatar_url,
    channel,
    reply_to: replyTo ?? null,
    // Show the quoted reply on the optimistic bubble immediately (the server
    // populates these on echo; without them the reply preview only appears
    // after a reload).
    reply_author: replyPreview?.author,
    reply_content: replyPreview?.content,
    images: images ?? [],
    pending: true,
  };
  messages = [...messages, optimistic];
  emit();

  try {
    const msg = await chatApi.send(content, channel, replyTo, images);
    // Replace the temp message with the real one (if the SSE echo hasn't already).
    if (msg) {
      const stillPending = messages.some((m) => m.id === tmpId);
      if (stillPending) {
        messages = messages.some((m) => m.id === msg.id)
          ? messages.filter((m) => m.id !== tmpId) // echo already added the real one
          : messages.map((m) => (m.id === tmpId ? msg : m));
        setCached(channel, messages);
        emit();
      }
    }
  } catch {
    // Mark the optimistic message failed so the UI can offer a retry.
    messages = messages.map((m) => (m.id === tmpId ? { ...m, pending: false, failed: true } : m));
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
