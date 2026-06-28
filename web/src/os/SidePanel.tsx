import { motion } from "framer-motion";
import { X } from "lucide-react";
import type { DesktopApp, Side } from "./types";

// A panel that slides in from its dock's edge and stops at the centered widget
// board (max-w-3xl = 48rem), so the board stays visible between the two sides.
// Geometry: dock occupies ~5.5rem at the edge; the board half-width is 24rem.
const DOCK_GAP = "5.25rem";
const BOARD_HALF = "24rem";
const PANEL_WIDTH = `clamp(18rem, calc(50vw - ${DOCK_GAP} - ${BOARD_HALF} - 0.75rem), 36rem)`;

export function SidePanel({
  side,
  app,
  onClose,
}: {
  side: Side;
  app: DesktopApp;
  onClose: () => void;
}) {
  const edge = side === "left" ? { left: DOCK_GAP } : { right: DOCK_GAP };

  return (
    <motion.div
      initial={{ opacity: 0, x: side === "left" ? -24 : 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: side === "left" ? -24 : 24 }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      style={{ ...edge, width: PANEL_WIDTH }}
      className="glass pointer-events-auto absolute top-9 bottom-3 z-[8000] flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[var(--window-bg)]/95 shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
        <span className="text-xs font-semibold text-white/80">{app.label}</span>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-white/50 transition-colors hover:bg-red-500/80 hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-auto">{app.render()}</div>
    </motion.div>
  );
}
