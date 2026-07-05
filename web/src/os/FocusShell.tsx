import { useState } from "react";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { DesktopApp, AppId, Side } from "./types";

// A drop zone that accepts an app dragged from another dock / the Apps drawer.
function dropProps(onDrop: (id: AppId) => void) {
  return {
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes("text/app-id")) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      const id = e.dataTransfer.getData("text/app-id");
      if (id) {
        e.preventDefault();
        onDrop(id as AppId);
      }
    },
  };
}

// FocusShell is the alternative layout: the Workspace stays on the left, the
// Widget board sits in the centre, and the app dock is a horizontal bar at the
// bottom. Opening an app takes over the full view (covering the Workspace +
// board); the top bar and bottom dock stay so you can switch/close apps.
//
// It reuses the same app list (each app's render() is self-contained) — this is
// purely a different shell; all shared state (terminals, buses, notifications)
// still lives in Desktop.
export function FocusShell({
  apps,
  allApps,
  home,
  board,
  activeApp,
  onOpenApp,
  onCloseApp,
  onDropApp,
}: {
  apps: DesktopApp[]; // apps shown in the bottom dock
  allApps: DesktopApp[]; // every openable app (for resolving the active one, incl. ones not pinned)
  home: React.ReactNode; // the Widget board shown when no app is open
  board?: React.ReactNode; // extra full-view nodes to keep mounted (e.g. terminal host)
  activeApp: AppId | null;
  onOpenApp: (id: AppId) => void; // toggles: same id closes
  onCloseApp: () => void;
  onDropApp: (id: AppId, side: Side) => void; // drag an app onto the bottom dock to pin it
}) {
  const active = allApps.find((a) => a.id === activeApp) ?? null;

  return (
    <>
      {/* Main area: widget board with the active app overlaid full (edge to edge). */}
      <div className="pointer-events-none absolute inset-x-0 top-7 bottom-[4.5rem]">
        <div className="pointer-events-auto absolute inset-0">{home}</div>
        {board}
        <AnimatePresence>
          {active && (
            <motion.div
              key={active.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.16 }}
              className="pointer-events-auto absolute inset-0 z-30 flex flex-col px-2"
            >
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[var(--window-bg)]/95 shadow-2xl backdrop-blur">
                {/* App header with title + close. */}
                <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
                  <span className={`flex h-5 w-5 items-center justify-center rounded bg-gradient-to-br ${active.accent} text-white`}>
                    <span className="[&>svg]:h-3 [&>svg]:w-3">{active.icon}</span>
                  </span>
                  <span className="text-sm font-medium text-white">{active.label}</span>
                  <button onClick={onCloseApp} className="ml-auto rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white" title="Close">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">{active.render()}</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom app dock. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center pb-2">
        <div className="pointer-events-auto flex max-w-[92vw] flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-[var(--window-bg)]/85 px-2 py-1.5 shadow-xl backdrop-blur" {...dropProps((id) => onDropApp(id, "right"))}>
          {apps.map((a) => (
            <DockButton key={a.id} app={a} active={a.id === activeApp} onClick={() => onOpenApp(a.id)} />
          ))}
        </div>
      </div>
    </>
  );
}

function DockButton({ app, active, onClick }: { app: DesktopApp; active: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  // Every dock icon is draggable except the Apps launcher itself (it's always
  // pinned first). Locations are keyed by id, so view apps move like real apps.
  const draggable = app.id !== "view:apps";
  return (
    <button
      onClick={onClick}
      draggable={draggable}
      onDragStart={draggable ? (e) => e.dataTransfer.setData("text/app-id", app.id) : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative flex h-10 w-10 items-center justify-center rounded-xl transition-transform hover:-translate-y-0.5"
      title={app.label}
    >
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow [&>svg]:!h-4 [&>svg]:!w-4 ${app.accent} ${active ? "ring-2 ring-white/70" : ""}`}>
        {app.icon}
      </span>
      {app.notify && <span className="absolute -right-0 -top-0 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-[var(--window-bg)]" />}
      {app.badge && <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 rounded-full bg-amber-400 px-1 text-[7px] font-bold uppercase leading-tight text-black">{app.badge}</span>}
      {active && <span className="absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white/80" />}
      {hover && (
        <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/85 px-1.5 py-0.5 text-[10px] text-white/90">
          {app.label}
        </span>
      )}
    </button>
  );
}
