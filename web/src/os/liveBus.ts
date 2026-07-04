// The single owner of the live event stream. Every feature (chat, posts,
// comments, marketplace, inbox, notifications, admin) subscribes here instead of
// opening its own EventSource. One connection means no per-feature connect race
// (which made comment counts lag until a refresh) and no duplicate streams.
//
// The stream is opened lazily on the first subscriber and kept open for the app
// lifetime (EventSource auto-reconnects on drop).
type Handler = (event: string, data: any) => void;

interface Entry {
  events: Set<string> | null; // null = receive every event
  fn: Handler;
}

const handlers = new Set<Entry>();
let es: EventSource | null = null;
let open = false;
const statusListeners = new Set<(open: boolean) => void>();

function setOpen(v: boolean) {
  open = v;
  statusListeners.forEach((l) => l(v));
}

function ensureStream() {
  if (es) return;
  es = new EventSource("/api/chat/stream");
  es.onopen = () => setOpen(true);
  es.onerror = () => setOpen(false); // EventSource auto-reconnects
  es.onmessage = (e) => {
    let ev: { event: string; data: any };
    try {
      ev = JSON.parse(e.data);
    } catch {
      return;
    }
    handlers.forEach((h) => {
      if (h.events === null || h.events.has(ev.event)) h.fn(ev.event, ev.data);
    });
  };
}

// subscribeLive listens for the given event names (or all, if omitted). Returns
// an unsubscribe function. Opening the stream here is safe to call anywhere.
export function subscribeLive(events: string[] | null, fn: Handler): () => void {
  const entry: Entry = { events: events ? new Set(events) : null, fn };
  handlers.add(entry);
  ensureStream();
  return () => {
    handlers.delete(entry);
  };
}

// isStreamOpen + onStreamStatus let features show a connection indicator
// (chat used its EventSource's onopen/onerror for this).
export function onStreamStatus(fn: (open: boolean) => void): () => void {
  statusListeners.add(fn);
  fn(open);
  return () => {
    statusListeners.delete(fn);
  };
}

// connectLive opens the stream eagerly (call once at app start so events are
// never missed because a feature mounted late).
export function connectLive() {
  ensureStream();
}
