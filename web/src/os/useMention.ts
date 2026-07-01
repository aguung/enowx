import { useCallback, useEffect, useRef, useState } from "react";
import { searchApi, type SearchUserHit } from "../lib/api";

// useMention powers @mention autocomplete for a text input/textarea. Track the
// current value; on each change it detects an "@partial" token ending at the
// caret, queries matching users, and exposes suggestions. Call pick() to replace
// the token with the chosen @username.
export function useMention(value: string, setValue: (v: string) => void, inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>) {
  const [items, setItems] = useState<SearchUserHit[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const tokenStart = useRef(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Find an "@partial" token immediately before the caret.
  const detect = useCallback(() => {
    const el = inputRef.current;
    const caret = el ? el.selectionStart ?? value.length : value.length;
    const upto = value.slice(0, caret);
    const m = upto.match(/(?:^|\s)@([A-Za-z0-9_.]{0,32})$/);
    if (!m) {
      setOpen(false);
      tokenStart.current = -1;
      return;
    }
    tokenStart.current = caret - m[1].length - 1; // index of '@'
    const q = m[1];
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const r = await searchApi.query(q.length ? q : "a"); // seed with a char when just "@"
        setItems((r.users ?? []).slice(0, 6));
        setActive(0);
        setOpen(true);
      } catch {
        setOpen(false);
      }
    }, 120);
  }, [value, inputRef]);

  useEffect(() => {
    detect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const pick = useCallback(
    (u: SearchUserHit) => {
      const el = inputRef.current;
      const caret = el ? el.selectionStart ?? value.length : value.length;
      if (tokenStart.current < 0) return;
      const before = value.slice(0, tokenStart.current);
      const after = value.slice(caret);
      const next = `${before}@${u.username} ${after}`;
      setValue(next);
      setOpen(false);
      // Restore caret just after the inserted mention.
      const pos = before.length + u.username.length + 2;
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(pos, pos);
      });
    },
    [value, setValue, inputRef],
  );

  // onKeyDown returns true if it handled the event (caller should not also act).
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!open || items.length === 0) return false;
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % items.length); return true; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + items.length) % items.length); return true; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(items[active]); return true; }
      if (e.key === "Escape") { setOpen(false); return true; }
      return false;
    },
    [open, items, active, pick],
  );

  return { items: open ? items : [], active, pick, onKeyDown, close: () => setOpen(false) };
}
