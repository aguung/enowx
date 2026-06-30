import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Place = "top" | "bottom" | "left" | "right";

// Tooltip shows a glass label on hover/focus. It renders into document.body so
// it is never clipped by a panel's overflow. Every interactive control should
// explain itself — see AGENTS.md "Buttons must explain themselves".
export function Tooltip({
  label,
  place = "top",
  maxWidth,
  block,
  children,
}: {
  label: string;
  place?: Place;
  maxWidth?: number; // when set, the tooltip wraps and is clamped within the viewport
  block?: boolean; // make the wrapper full-width (so children can stretch)
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const show = () => {
    const el = ref.current?.firstElementChild ?? ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 6;
    let p: { x: number; y: number };
    switch (place) {
      case "bottom":
        p = { x: r.left + r.width / 2, y: r.bottom + gap };
        break;
      case "left":
        p = { x: r.left - gap, y: r.top + r.height / 2 };
        break;
      case "right":
        p = { x: r.right + gap, y: r.top + r.height / 2 };
        break;
      default:
        p = { x: r.left + r.width / 2, y: r.top - gap };
    }
    // For wide (wrapping) tooltips, keep the box inside the viewport so a long
    // centered label can't run off the left/right edge of a narrow panel.
    if (maxWidth && (place === "top" || place === "bottom")) {
      const half = maxWidth / 2;
      const margin = 8;
      p.x = Math.min(Math.max(p.x, half + margin), window.innerWidth - half - margin);
    }
    setPos(p);
  };

  const transform =
    place === "top"
      ? "translate(-50%, -100%)"
      : place === "bottom"
        ? "translate(-50%, 0)"
        : place === "left"
          ? "translate(-100%, -50%)"
          : "translate(0, -50%)";

  return (
    <span
      ref={ref}
      className={block ? "flex w-full" : "inline-flex"}
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
      onFocusCapture={show}
      onBlurCapture={() => setPos(null)}
    >
      {children}
      {pos &&
        createPortal(
          <span
            role="tooltip"
            style={{ position: "fixed", left: pos.x, top: pos.y, transform, maxWidth }}
            className={`pointer-events-none z-[10000] rounded-md bg-black/85 px-2 py-0.5 text-[11px] font-medium text-white ring-1 ring-white/10 shadow-lg ${
              maxWidth ? "whitespace-normal leading-snug" : "whitespace-nowrap"
            }`}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
