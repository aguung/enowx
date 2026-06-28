import { useState } from "react";
import { LayoutGrid } from "lucide-react";
import type { AppId, DesktopApp } from "./types";

// AppsDrawer lists apps not currently on a dock. Drag an app card onto a dock to
// add it there; drag a docked app onto this drawer to remove it from the dock.
export function AppsDrawer({
  apps,
  onOpen,
  onDropToDrawer,
}: {
  apps: DesktopApp[];
  onOpen: (id: AppId) => void;
  onDropToDrawer: (id: AppId) => void;
}) {
  const [over, setOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("text/app-id")) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData("text/app-id");
        if (id) {
          e.preventDefault();
          onDropToDrawer(id as AppId);
        }
      }}
      className={`h-full overflow-auto rounded-2xl border bg-[var(--window-bg)]/60 p-4 transition-colors ${
        over ? "border-emerald-400/40 bg-emerald-400/[0.04]" : "border-white/10"
      }`}
    >
      <div className="mb-3 flex items-center gap-2 text-white/60">
        <LayoutGrid className="h-4 w-4" />
        <span className="text-xs font-semibold uppercase tracking-wide">Apps</span>
        <span className="text-[11px] font-normal text-white/30">drag to a dock to pin · drag a docked app here to remove</span>
      </div>

      {apps.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-sm text-white/40">
          All apps are on the docks. Drag one here to remove it from a dock.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {apps.map((app) => (
            <button
              key={app.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/app-id", app.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onClick={() => onOpen(app.id)}
              className="flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:bg-white/[0.07]"
            >
              <span className={"flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md [&>svg]:!h-5 [&>svg]:!w-5 " + app.accent}>
                {app.icon}
              </span>
              <span className="text-[11px] text-white/70">{app.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}