import { useEffect } from "react";

// adminBus relays the moderator-only "admin_event" live signal (a new flag or a
// moderation action) so open Admin Tools tabs can refetch. It keeps one SSE
// connection to the cloud relay open while subscribed.
let es: EventSource | null = null;
const listeners = new Set<() => void>();

function ensureStream() {
  if (es) return;
  es = new EventSource("/api/chat/stream");
  es.addEventListener("message", (e) => {
    try {
      const ev = JSON.parse((e as MessageEvent).data) as { event: string };
      if (ev.event === "admin_event") listeners.forEach((l) => l());
    } catch {
      /* ignore */
    }
  });
}

// useAdminEvents runs `onEvent` whenever an admin_event arrives (debounced by
// the caller's own fetch). Only mount this inside moderator-only views.
export function useAdminEvents(onEvent: () => void) {
  useEffect(() => {
    ensureStream();
    listeners.add(onEvent);
    return () => {
      listeners.delete(onEvent);
      if (listeners.size === 0 && es) {
        es.close();
        es = null;
      }
    };
  }, [onEvent]);
}
