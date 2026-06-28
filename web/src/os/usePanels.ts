import { useCallback } from "react";
import { usePersisted } from "./usePersisted";
import type { AppId, Side } from "./types";

// One active app per side. Opening an app toggles it (same app closes the side;
// a different app on the same side replaces it). Persisted across reloads.
export function usePanels() {
  const [active, setActive] = usePersisted<Record<Side, AppId | null>>("panels", { left: null, right: null });

  const toggle = useCallback((side: Side, appId: AppId) => {
    setActive((prev) => ({ ...prev, [side]: prev[side] === appId ? null : appId }));
  }, []);

  const close = useCallback((side: Side) => {
    setActive((prev) => ({ ...prev, [side]: null }));
  }, []);

  return { active, toggle, close };
}
