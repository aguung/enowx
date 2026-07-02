// A tiny cross-app signal: when something consumes an account's quota (e.g. a
// Suno music generation from the Chat app), it emits here so the Accounts app can
// refetch that provider's usage/credit without a manual refresh.
type Listener = (provider: string) => void;

const listeners = new Set<Listener>();

// markUsageStale tells listeners that a provider's usage may have changed.
export function markUsageStale(provider: string) {
  listeners.forEach((l) => l(provider));
}

// onUsageStale subscribes to usage-stale signals. Returns an unsubscribe fn.
export function onUsageStale(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
