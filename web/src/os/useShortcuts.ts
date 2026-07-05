import { useEffect, useRef, useState } from "react";

// Hold-to-act shortcuts. Hold Ctrl or Alt (left OR right) and the shortcut hint
// appears immediately; while held, press a mapped key to act instantly; release
// the modifier and the hint disappears. We preventDefault on handled keys so the
// browser doesn't also act (tab-level chords like Ctrl+T can't be cancelled, so
// the keymap avoids those).
//
// run(key) is called with the lowercase plain key. Returns whether a leader
// modifier is currently held (for the on-screen hint).
export function useShortcuts(run: (key: string) => void): boolean {
  const [holding, setHolding] = useState(false);
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    const isMod = (e: KeyboardEvent) => e.key === "Control" || e.key === "Alt";

    // Standard editing / browser chords we must never swallow, or Ctrl+C/V/X/…
    // stop working on Windows/Linux (where Ctrl is the clipboard modifier, unlike
    // macOS which uses Cmd). When Ctrl is held, let the browser handle these.
    const RESERVED = new Set(["c", "v", "x", "a", "z", "y", "s", "f", "p", "r", "w", "t", "n"]);

    // Don't hijack keys while the user is typing in a field.
    const inEditable = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isMod(e)) {
        setHolding(true);
        return;
      }
      // Only act while a leader modifier is held. Ignore if Cmd/Meta is involved
      // and ignore plain typing (multi-char keys like Shift/Arrow).
      if (!(e.ctrlKey || e.altKey) || e.metaKey) return;
      if (e.key.length !== 1) return; // letters/digits only
      // Never override native editing/browser shortcuts when Ctrl is held (copy,
      // paste, cut, select-all, save, find, …) — Alt still triggers every
      // shortcut, so the leader keys keep working via Alt on all platforms.
      if (e.ctrlKey && !e.altKey && RESERVED.has(e.key.toLowerCase())) return;
      // Also leave typing in inputs alone.
      if (inEditable(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      runRef.current(e.key.toLowerCase());
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (isMod(e) && !e.ctrlKey && !e.altKey) setHolding(false);
    };
    const reset = () => setHolding(false);

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", reset);
    };
  }, []);

  return holding;
}
