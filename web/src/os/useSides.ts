import { useCallback, useState } from "react";
import type { AppId, Location } from "./types";

const KEY = "enx.app-locations";

// useAppLocations tracks where each app lives (left dock, right dock, or the
// Apps drawer), persisted to localStorage. Apps default to their `home`.
export function useAppLocations(defaults: Record<AppId, Location>) {
  const [locations, setLocations] = useState<Record<AppId, Location>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<Record<AppId, Location>>;
      return { ...defaults, ...saved };
    } catch {
      return defaults;
    }
  });

  const move = useCallback((id: AppId, to: Location) => {
    setLocations((prev) => {
      if (prev[id] === to) return prev;
      const next = { ...prev, [id]: to };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  return { locations, move };
}