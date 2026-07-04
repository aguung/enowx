import { useCallback, useEffect, useRef, useState } from "react";

// useCachedList caches a fetched list per key at module scope so switching admin
// tabs (or reopening a panel) shows the last data instantly, then refreshes in
// the background — no spinner on re-open, like the chat/posts caches. The first
// ever load shows a spinner (data === null); subsequent opens are instant.
//
//   const { data, refresh } = useCachedList("admin:coupons", () => couponAdminApi.list().then(r => r.coupons ?? []));

type Entry<T> = { data: T | null; listeners: Set<(d: T | null) => void> };
const cache = new Map<string, Entry<unknown>>();

function entryFor<T>(key: string): Entry<T> {
  let e = cache.get(key) as Entry<T> | undefined;
  if (!e) {
    e = { data: null, listeners: new Set() };
    cache.set(key, e as Entry<unknown>);
  }
  return e;
}

// Push new data into a cache key from outside a component (e.g. a realtime event
// handler that already has the fresh value).
export function setCachedList<T>(key: string, data: T) {
  const e = entryFor<T>(key);
  e.data = data;
  e.listeners.forEach((l) => l(data));
}

export function useCachedList<T>(key: string, fetcher: () => Promise<T>) {
  const e = entryFor<T>(key);
  const [data, setData] = useState<T | null>(e.data);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  const refresh = useCallback(async () => {
    try {
      const next = await fetchRef.current();
      const cur = entryFor<T>(key);
      cur.data = next;
      cur.listeners.forEach((l) => l(next));
    } catch {
      /* keep whatever we have */
    }
  }, [key]);

  useEffect(() => {
    const cur = entryFor<T>(key);
    cur.listeners.add(setData);
    setData(cur.data); // show cached immediately
    refresh(); // …then refresh in the background
    return () => {
      cur.listeners.delete(setData);
    };
  }, [key, refresh]);

  return { data, refresh };
}
