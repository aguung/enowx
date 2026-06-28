import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { LayoutGrid, SquareTerminal } from "lucide-react";
import { buildApps } from "../apps";
import { SideDock } from "./SideDock";
import { SidePanel } from "./SidePanel";
import { TopBar } from "./TopBar";
import { Widgets } from "./Widgets";
import { TerminalApp } from "./TerminalApp";
import { usePanels } from "./usePanels";
import { useSides } from "./useSides";
import type { AppId, Side } from "./types";

type CenterView = "widget" | "terminal";

export function Desktop() {
  const apps = buildApps();
  const { active, toggle, close } = usePanels();
  const [view, setView] = useState<CenterView>("widget");

  const defaults = Object.fromEntries(apps.map((a) => [a.id, a.side])) as Record<AppId, Side>;
  const { sides, move } = useSides(defaults);

  const sideOf = (id: AppId): Side => sides[id] ?? "left";
  const appsOn = (side: Side) => apps.filter((a) => sideOf(a.id) === side);
  const find = (id: AppId | null) => apps.find((a) => a.id === id);

  const renderPanel = (side: Side) => {
    const id = active[side];
    const app = find(id);
    // Only render the panel on the side the app currently lives on.
    return app && id && sideOf(id) === side ? (
      <SidePanel side={side} app={app} onClose={() => close(side)} />
    ) : null;
  };

  return (
    <div className="wallpaper fixed inset-0 select-none overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-7 bottom-3">
        <div className="pointer-events-auto mx-auto flex h-full max-w-3xl flex-col px-5 pb-3 pt-5">
          <div className="min-h-0 flex-1 overflow-hidden">
            {view === "widget" ? (
              <div className="h-full overflow-auto">
                <Widgets onOpen={(id) => toggle(sideOf(id), id)} />
              </div>
            ) : (
              <TerminalApp />
            )}
          </div>
          <CenterNav view={view} onView={setView} />
        </div>
      </div>

      <TopBar />

      <SideDock side="left" apps={appsOn("left")} activeId={active.left} onOpen={toggle} onDropApp={(id) => move(id, "left")} />
      <SideDock side="right" apps={appsOn("right")} activeId={active.right} onOpen={toggle} onDropApp={(id) => move(id, "right")} />

      <AnimatePresence>{renderPanel("left")}</AnimatePresence>
      <AnimatePresence>{renderPanel("right")}</AnimatePresence>
    </div>
  );
}

function CenterNav({ view, onView }: { view: CenterView; onView: (v: CenterView) => void }) {
  const tabs: { id: CenterView; label: string; icon: typeof LayoutGrid }[] = [
    { id: "widget", label: "Widget", icon: LayoutGrid },
    { id: "terminal", label: "Terminal", icon: SquareTerminal },
  ];
  return (
    <div className="mt-3 flex shrink-0 justify-center">
      <div className="glass flex gap-1 rounded-xl border border-white/10 bg-[var(--dock-bg)] p-1">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => onView(t.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                view === t.id ? "bg-white/12 text-white" : "text-white/50 hover:text-white/80"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
