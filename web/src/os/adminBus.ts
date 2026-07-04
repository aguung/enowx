import { useEffect } from "react";
import { subscribeLive } from "./liveBus";

// adminBus relays the moderator-only "admin_event" live signal (a new flag or a
// moderation action) so open Admin Tools tabs can refetch. It keeps one SSE
// connection to the cloud relay open while subscribed.
let subscribed = false;
const listeners = new Set<() => void>();

function ensureStream() {
  if (subscribed) return;
  subscribed = true;
  subscribeLive(["admin_event"], () => listeners.forEach((l) => l()));
}

// useAdminEvents runs `onEvent` whenever an admin_event arrives (debounced by
// the caller's own fetch). Only mount this inside moderator-only views.
export function useAdminEvents(onEvent: () => void) {
  useEffect(() => {
    ensureStream();
    listeners.add(onEvent);
    return () => {
      listeners.delete(onEvent);
    };
  }, [onEvent]);
}
