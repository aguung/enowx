import { useCallback, useEffect } from "react";
import { usePersisted } from "./usePersisted";
import type { AppId, Side } from "./types";

// openPanelCount is a module-level signal of how many side panels are open (0–2),
// so the too-small guard can require more width when both sides are showing.
let openPanelCount = 0;
const countListeners = new Set<(n: number) => void>();
export function subscribeOpenPanels(fn: (n: number) => void): () => void {
  countListeners.add(fn);
  fn(openPanelCount);
  return () => countListeners.delete(fn);
}
function setOpenPanelCount(n: number) {
  if (n === openPanelCount) return;
  openPanelCount = n;
  countListeners.forEach((l) => l(n));
}

// closeAllPanels lets the too-small overlay dismiss both side panels (an escape
// hatch when two panels don't fit and the close buttons are covered).
let closeAllFn: () => void = () => {};
export function closeAllPanels() {
  closeAllFn();
}

// One active app per side. Opening an app toggles it (same app closes the side;
// a different app on the same side replaces it). Persisted across reloads.
export function usePanels() {
  const [active, setActive] = usePersisted<Record<Side, AppId | null>>("panels", { left: null, right: null });

  // Keep the global open-panel count in sync for the too-small guard, and expose
  // a way for the guard to close both panels.
  useEffect(() => {
    setOpenPanelCount((active.left ? 1 : 0) + (active.right ? 1 : 0));
  }, [active.left, active.right]);
  useEffect(() => {
    closeAllFn = () => setActive({ left: null, right: null });
    return () => { closeAllFn = () => {}; };
  }, [setActive]);

  const toggle = useCallback((side: Side, appId: AppId) => {
    setActive((prev) => ({ ...prev, [side]: prev[side] === appId ? null : appId }));
  }, []);

  const close = useCallback((side: Side) => {
    setActive((prev) => ({ ...prev, [side]: null }));
  }, []);

  return { active, toggle, close };
}
