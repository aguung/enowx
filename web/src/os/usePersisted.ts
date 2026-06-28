import { useEffect, useRef, useState } from "react";

const PREFIX = "enx.";

// usePersisted is a useState that mirrors its value to localStorage under
// `enx.<key>`. Use it for any UI/preference state that should survive reloads
// (see AGENTS.md — persistence is mandatory for new UI state).
export function usePersisted<T>(key: string, initial: T) {
  const storageKey = PREFIX + key;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  // Avoid an extra write on the very first render.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // ignore quota/availability errors
    }
  }, [storageKey, value]);

  return [value, setValue] as const;
}
