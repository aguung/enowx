import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

// useReverseScroll powers Discord-style chat panes: the newest message is at the
// bottom, the view opens pinned to the bottom, new incoming messages keep you
// pinned ONLY if you were already at the bottom (so live messages don't yank you
// while reading history), and scrolling near the top lazy-loads older messages
// while preserving the scroll position across the prepend (no jump).
//
// Usage: attach `ref` to the scrollable container. `count` is the current number
// of items; `loadOlder` fetches + prepends older items and resolves; `hasMore`
// gates loading; `loading` reflects an in-flight older-load.
export function useReverseScroll(opts: {
  ref: React.RefObject<HTMLElement | null>;
  count: number; // total items rendered (for detecting appends vs prepends)
  hasMore: boolean;
  loading: boolean;
  loadOlder: () => void;
  threshold?: number; // px from top that triggers a load (default 120)
}) {
  const { ref, count, hasMore, loading, loadOlder, threshold = 120 } = opts;

  const atBottomRef = useRef(true);
  const prevCount = useRef(count);
  // Scroll-height snapshot taken right before a prepend, to restore position.
  const prependAnchor = useRef<{ height: number; top: number } | null>(null);
  const didInitial = useRef(false);

  const isAtBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 40;

  const scrollToBottom = useCallback(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [ref]);

  // Track whether the user is at the bottom + trigger older-loads near the top.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      atBottomRef.current = isAtBottom(el);
      if (el.scrollTop <= threshold && hasMore && !loading) {
        // Snapshot before the prepend so we can restore the visual position.
        prependAnchor.current = { height: el.scrollHeight, top: el.scrollTop };
        loadOlder();
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [ref, hasMore, loading, loadOlder, threshold]);

  // On count changes: distinguish first load, prepend (older), append (newer).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (!didInitial.current && count > 0) {
      didInitial.current = true;
      prevCount.current = count;
      el.scrollTop = el.scrollHeight; // open at the newest
      atBottomRef.current = true;
      return;
    }

    if (prependAnchor.current) {
      // Older messages were prepended → restore so the viewport doesn't jump.
      const { height, top } = prependAnchor.current;
      prependAnchor.current = null;
      el.scrollTop = top + (el.scrollHeight - height);
      prevCount.current = count;
      return;
    }

    if (count > prevCount.current) {
      // Newer message(s) appended → follow only if already at the bottom.
      if (atBottomRef.current) el.scrollTop = el.scrollHeight;
    }
    prevCount.current = count;
  }, [count, ref]);

  // Reset when the pane is swapped (e.g. channel/thread change).
  const reset = useCallback(() => {
    didInitial.current = false;
    prevCount.current = 0;
    prependAnchor.current = null;
    atBottomRef.current = true;
  }, []);

  return { scrollToBottom, reset, atBottom: () => atBottomRef.current };
}
