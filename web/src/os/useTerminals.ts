import { useCallback, useRef, useState } from "react";
import type { Side } from "./types";

export type TermLocation = "center" | Side;

export interface Term {
  id: number;
  title: string;
  location: TermLocation;
}

// useTerminals owns every terminal session. Terminals can live in the center
// tab strip or be moved onto the left/right dock; moving only changes location
// (the instance is portaled, so the PTY session stays alive).
//
// IDs come from a ref counter, not state, so they are unaffected by React's
// double-invoked updaters in StrictMode (which previously added two tabs).
export function useTerminals() {
  const nextId = useRef(1);
  const [terms, setTerms] = useState<Term[]>([{ id: 0, title: "terminal", location: "center" }]);
  const [activeCenter, setActiveCenter] = useState(0);

  const add = useCallback(() => {
    const id = nextId.current++;
    setTerms((t) => [...t, { id, title: `terminal ${id + 1}`, location: "center" }]);
    setActiveCenter(id);
  }, []);

  const close = useCallback((id: number) => {
    setTerms((prev) => {
      const next = prev.filter((t) => t.id !== id);
      // Keep at least one center terminal so the Terminal view is never empty.
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
  }, [activeCenter]);

  const rename = useCallback((id: number, title: string) => {
    setTerms((prev) => prev.map((t) => (t.id === id ? { ...t, title: title.trim() || t.title } : t)));
  }, []);

  const moveTo = useCallback((id: number, location: TermLocation) => {
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
  }, [activeCenter]);

  return { terms, activeCenter, setActiveCenter, add, close, rename, moveTo };
}
