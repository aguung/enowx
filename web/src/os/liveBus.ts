// A tiny shared subscriber for cloud live events that don't have their own bus
// (marketplace listings, orders, plugin marketplace). It opens one EventSource
// to the same /api/chat/stream relay and fans events out to subscribers, each
// filtered to the event names it cares about.
type Handler = (event: string, data: any) => void;

const handlers = new Set<{ events: Set<string>; fn: Handler }>();
let es: EventSource | null = null;

function ensureStream() {
  if (es) return;
  es = new EventSource("/api/chat/stream");
  es.onmessage = (e) => {
    try {
      const ev = JSON.parse(e.data) as { event: string; data: any };
      handlers.forEach((h) => {
        if (h.events.has(ev.event)) h.fn(ev.event, ev.data);
      });
    } catch {
      /* ignore */
    }
  };
}

// subscribeLive listens for the given event names. Returns an unsubscribe fn.
export function subscribeLive(events: string[], fn: Handler): () => void {
  const entry = { events: new Set(events), fn };
  handlers.add(entry);
  ensureStream();
  return () => {
    handlers.delete(entry);
  };
}
