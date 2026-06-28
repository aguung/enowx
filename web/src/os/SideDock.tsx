import { useState } from "react";
import { SquareTerminal, X } from "lucide-react";
import type { AppId, DesktopApp, Side } from "./types";
import type { Term } from "./useTerminals";

// A floating vertical dock pinned to one edge. Holds app icons (draggable
// between sides) and any terminals moved onto this side (hover to reveal close).
export function SideDock({
  side,
  apps,
  terms,
  activeId,
  openTermId,
  onOpen,
  onOpenTerm,
  onCloseTerm,
  onDropApp,
  onDropTerm,
}: {
  side: Side;
  apps: DesktopApp[];
  terms: Term[];
  activeId: AppId | null;
  openTermId: number | null;
  onOpen: (side: Side, id: AppId) => void;
  onOpenTerm: (id: number) => void;
  onCloseTerm: (id: number) => void;
  onDropApp: (id: AppId) => void;
  onDropTerm: (id: number) => void;
}) {
  const [over, setOver] = useState(false);
  const edge = side === "left" ? "left-3" : "right-3";
  const tip = side === "left" ? "left-14" : "right-14";

  return (
    <div className={`pointer-events-none absolute ${edge} top-7 bottom-3 z-[9000] flex items-center`}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const appId = e.dataTransfer.getData("text/app-id");
          if (appId) {
            onDropApp(appId as AppId);
            return;
          }
          const termId = e.dataTransfer.getData("text/term-id");
          if (termId) onDropTerm(Number(termId));
        }}
        className={`glass pointer-events-auto flex flex-col gap-2 rounded-2xl border bg-[var(--dock-bg)] p-2 shadow-2xl transition-colors ${
          over ? "border-emerald-400/50 bg-emerald-400/5" : "border-white/10"
        }`}
      >
        {apps.map((app) => (
          <button
            key={app.id}
            title={app.label}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/app-id", app.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onClick={() => onOpen(side, app.id)}
            className="group relative flex items-center justify-center"
          >
            <span className={`pointer-events-none absolute ${tip} whitespace-nowrap rounded-md bg-black/80 px-2 py-0.5 text-[11px] font-medium text-white opacity-0 ring-1 ring-white/10 transition-opacity group-hover:opacity-100`}>
              {app.label}
            </span>
            <span className={"flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md [&>svg]:!h-5 [&>svg]:!w-5 " + app.accent}>
              {app.icon}
            </span>
            <span
              className={
                "pointer-events-none absolute h-1 w-1 rounded-full transition-opacity " +
                (side === "left" ? "-right-1.5" : "-left-1.5") +
                (activeId === app.id ? " bg-white/90 opacity-100" : " opacity-0")
              }
            />
          </button>
        ))}

        {terms.length > 0 && apps.length > 0 && <div className="mx-1 h-px bg-white/10" />}

        {terms.map((t) => (
          <div key={t.id} className="group relative flex items-center justify-center">
            <span className={`pointer-events-none absolute ${tip} whitespace-nowrap rounded-md bg-black/80 px-2 py-0.5 text-[11px] font-medium text-white opacity-0 ring-1 ring-white/10 transition-opacity group-hover:opacity-100`}>
              {t.title}
            </span>
            <button
              title={t.title}
              onClick={() => onOpenTerm(t.id)}
              className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-green-700 text-white shadow-md"
            >
              <SquareTerminal className="h-5 w-5" />
            </button>
            {/* Hover-only close, specific to terminals on the dock. */}
            <button
              onClick={() => onCloseTerm(t.id)}
              title="Close terminal"
              className="absolute -right-1 -top-1 rounded-full bg-black/80 p-0.5 text-white/70 opacity-0 ring-1 ring-white/15 transition-opacity hover:bg-red-500 hover:text-white group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
            <span
              className={
                "pointer-events-none absolute h-1 w-1 rounded-full transition-opacity " +
                (side === "left" ? "-right-1.5" : "-left-1.5") +
                (openTermId === t.id ? " bg-white/90 opacity-100" : " opacity-0")
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}
