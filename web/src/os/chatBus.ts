import { useEffect, useState } from "react";
import { chatApi, type ChatMessage, type Reaction, type ChatChannel } from "../lib/api";

// chatBus is the shared community-chat store: it loads history for the active
// channel, holds the live message list, and keeps a single SSE connection
// (/api/chat/stream) open so new messages arrive in realtime.
let messages: ChatMessage[] = [];
let channels: ChatChannel[] = [];
let channel = "indonesia";
let loading = false;
let es: EventSource | null = null;
let connected = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export async function loadChannel(ch?: string) {
  if (ch !== undefined) channel = ch;
  loading = true;
  emit();
  try {
    const r = await chatApi.list(channel);
    // Server returns newest-first; show oldest-first.
    messages = (r.messages ?? []).slice().reverse();
    if (r.channels) channels = r.channels;
  } catch {
    /* leave as-is */
  } finally {
    loading = false;
    emit();
  }
}

function ensureStream() {
  if (es) return;
  es = new EventSource("/api/chat/stream");
  es.onopen = () => {
    connected = true;
    emit();
  };
  es.onerror = () => {
    connected = false;
    emit();
    // EventSource auto-reconnects; nothing else to do.
  };
  es.onmessage = (e) => {
    try {
      const ev = JSON.parse(e.data) as { event: string; data: any };
      if (ev.event === "chat_message" && ev.data) {
        // Only show messages for the channel we're viewing; de-dupe by id.
        if (ev.data.channel && ev.data.channel !== channel) return;
        if (!messages.some((m) => m.id === ev.data.id)) {
          messages = [...messages, ev.data as ChatMessage];
          emit();
        }
      } else if (ev.event === "message_edited" && ev.data) {
        messages = messages.map((m) =>
          m.id === ev.data.id ? { ...m, content: ev.data.content, edited_at: ev.data.edited_at } : m,
        );
        emit();
      } else if (ev.event === "message_deleted" && ev.data) {
        messages = messages.filter((m) => m.id !== ev.data.id);
        emit();
      } else if (ev.event === "reaction_changed" && ev.data) {
        // Broadcast carries counts; `me` is per-viewer, so preserve our own.
        const incoming: Reaction[] = ev.data.reactions ?? [];
        messages = messages.map((m) => {
          if (m.id !== ev.data.message_id) return m;
          const mine = new Set((m.reactions ?? []).filter((rx) => rx.me).map((rx) => rx.emoji));
          return { ...m, reactions: incoming.map((rx) => ({ ...rx, me: mine.has(rx.emoji) })) };
        });
        emit();
      }
    } catch {
      /* ignore malformed frames */
    }
  };
}

export async function sendChat(content: string, replyTo?: number, imageUrl?: string) {
  const msg = await chatApi.send(content, channel, replyTo, imageUrl);
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
  connected: boolean;
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
  return { messages, channels, channel, loading, connected };
}
