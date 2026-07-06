import { createPortal } from "react-dom";
import { TerminalView } from "./TerminalView";
import type { Term, TermLocation } from "./useTerminals";

// TerminalLayer mounts every TerminalView exactly once and portals each into the
// DOM node for its current location. Because the component instance never
// unmounts on a move, its WebSocket/PTY session stays alive.
export function TerminalLayer({
  terms,
  activeCenter,
  hosts,
}: {
  terms: Term[];
  activeCenter: number;
  hosts: Record<TermLocation, HTMLElement | null>;
}) {
  return (
    <>
      {terms.map((t) => {
        const host = hosts[t.location];
        if (!host) return null;
        // In the center, only the active terminal is visible; on a dock side the
        // single open terminal fills its panel.
        const visible = t.location === "center" ? t.id === activeCenter : true;
        return createPortal(
          <div className={`absolute inset-0 ${visible ? "" : "hidden"}`}>
            <TerminalView sessionId={t.id} profile={t.profile} />
          </div>,
          host,
          `term-${t.id}`,
        );
      })}
    </>
  );
}
