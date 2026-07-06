import { useCallback, useRef } from "react";
import { usePersisted } from "./usePersisted";
import type { Side } from "./types";

export type TermLocation = "center" | Side;

export interface Term {
  id: number;
  title: string;
  location: TermLocation;
  // Optional terminal-profile slug: the shell runs under that profile's isolated
  // HOME (separate tool credentials). Undefined = default (real home).
  profile?: string;
}

const DEFAULT: Term[] = [{ id: 0, title: "terminal", location: "center" }];

// useTerminals owns every terminal session. The tab structure (ids, titles,
// locations, active center) is persisted; the PTY itself reconnects on reload.
//
// IDs come from a ref counter (seeded past the persisted max) so they are
// unaffected by React's double-invoked updaters in StrictMode.
export function useTerminals() {
  const [terms, setTerms] = usePersisted<Term[]>("terminals", DEFAULT);
  const [activeCenter, setActiveCenter] = usePersisted<number>("terminals-active", 0);
  const nextId = useRef(Math.max(0, ...terms.map((t) => t.id)) + 1);

  const add = useCallback((profile?: string) => {
    const id = nextId.current++;
    setTerms((t) => [...t, { id, title: `terminal ${id + 1}`, location: "center", profile }]);
    setActiveCenter(id);
  }, [setTerms, setActiveCenter]);

  const close = useCallback(
    (id: number) => {
      setTerms((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (!next.some((t) => t.location === "center")) {
          const fresh = nextId.current++;
          setActiveCenter(fresh);
          next.push({ id: fresh, title: "terminal", location: "center" });
        } else if (id === activeCenter) {
          const centers = next.filter((t) => t.location === "center");
          if (centers.length) setActiveCenter(centers[centers.length - 1].id);
        }
        return next;
      });
    },
    [activeCenter, setTerms, setActiveCenter],
  );

  const rename = useCallback(
    (id: number, title: string) => {
      setTerms((prev) => prev.map((t) => (t.id === id ? { ...t, title: title.trim() || t.title } : t)));
    },
    [setTerms],
  );

  const moveTo = useCallback(
    (id: number, location: TermLocation) => {
      setTerms((prev) => {
        const moving = prev.find((t) => t.id === id);
        if (!moving || moving.location === location) return prev;
        const next = prev.map((t) => (t.id === id ? { ...t, location } : t));
        if (location !== "center") {
          const centers = next.filter((t) => t.location === "center");
          if (centers.length && !centers.some((t) => t.id === activeCenter)) {
            setActiveCenter(centers[centers.length - 1].id);
          }
        } else {
          setActiveCenter(id);
        }
        return next;
      });
    },
    [activeCenter, setTerms, setActiveCenter],
  );

  return { terms, activeCenter, setActiveCenter, add, close, rename, moveTo };
}
