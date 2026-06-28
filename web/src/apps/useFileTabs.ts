import { useCallback, useEffect, useState } from "react";

const KEY = "enx.file-tabs";

export interface FileTab {
  id: number;
  path: string | null; // null = home (resolved by backend)
}

interface Persisted {
  tabs: FileTab[];
  activeId: number;
  seq: number;
}

function load(): Persisted {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || "") as Persisted;
    if (p && Array.isArray(p.tabs) && p.tabs.length) return p;
  } catch {
    // fall through to default
  }
  return { tabs: [{ id: 0, path: null }], activeId: 0, seq: 1 };
}

// useFileTabs keeps the file-manager tabs (each with its own directory) and
// persists everything so reopening Files restores the same tabs and locations.
export function useFileTabs() {
  const [state, setState] = useState<Persisted>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // ignore storage errors
    }
  }, [state]);

  const setActive = useCallback((id: number) => setState((s) => ({ ...s, activeId: id })), []);

  const add = useCallback(() => {
    setState((s) => {
      const id = s.seq;
      return { tabs: [...s.tabs, { id, path: null }], activeId: id, seq: s.seq + 1 };
    });
  }, []);

  const close = useCallback((id: number) => {
    setState((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      if (tabs.length === 0) {
        return { tabs: [{ id: s.seq, path: null }], activeId: s.seq, seq: s.seq + 1 };
      }
      const activeId = id === s.activeId ? tabs[tabs.length - 1].id : s.activeId;
      return { ...s, tabs, activeId };
    });
  }, []);

  const setPath = useCallback((id: number, path: string | null) => {
    setState((s) => ({ ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, path } : t)) }));
  }, []);

  return { tabs: state.tabs, activeId: state.activeId, setActive, add, close, setPath };
}
