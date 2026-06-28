import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { LayoutGrid, SquareTerminal } from "lucide-react";
import { buildApps } from "../apps";
import { SideDock } from "./SideDock";
import { SidePanel } from "./SidePanel";
import { TopBar } from "./TopBar";
import { Widgets } from "./Widgets";
import { CenterTerminal } from "./CenterTerminal";
import { TerminalLayer } from "./TerminalLayer";
import { usePanels } from "./usePanels";
import { usePersisted } from "./usePersisted";
import { useSides } from "./useSides";
import { useTerminals, type TermLocation } from "./useTerminals";
import type { AppId, Side } from "./types";

type CenterView = "widget" | "terminal";

export function Desktop() {
  const apps = buildApps();
  const { active, toggle, close } = usePanels();
  const [view, setView] = usePersisted<CenterView>("center-view", "widget");

  const defaults = Object.fromEntries(apps.map((a) => [a.id, a.side])) as Record<AppId, Side>;
  const { sides, move } = useSides(defaults);
  const term = useTerminals();

  // Per-location DOM hosts the terminal instances are portaled into.
  const [centerHost, setCenterHost] = useState<HTMLElement | null>(null);
  const [leftHost, setLeftHost] = useState<HTMLElement | null>(null);
  const [rightHost, setRightHost] = useState<HTMLElement | null>(null);
  const hosts: Record<TermLocation, HTMLElement | null> = { center: centerHost, left: leftHost, right: rightHost };

  const sideOf = (id: AppId): Side => sides[id] ?? "left";
  const appsOn = (side: Side) => apps.filter((a) => sideOf(a.id) === side);
  const termsOn = (side: Side) => term.terms.filter((t) => t.location === side);
  const findApp = (id: AppId | null) => apps.find((a) => a.id === id);

  // A dock side may have an app panel open OR a terminal panel open.
  const [openTerm, setOpenTerm] = usePersisted<Record<Side, number | null>>("open-term", { left: null, right: null });
  const openTermOn = (side: Side) => term.terms.find((t) => t.location === side && t.id === openTerm[side]) ?? null;

  const renderPanel = (side: Side) => {
    const openT = openTermOn(side);
    if (openT) {
      return (
        <SidePanel
          side={side}
          title={openT.title}
          onClose={() => {
            term.close(openT.id);
            setOpenTerm((p) => ({ ...p, [side]: null }));
          }}
          hostRef={side === "left" ? setLeftHost : setRightHost}
        />
      );
    }
    const id = active[side];
    const app = findApp(id);
    return app && id && sideOf(id) === side ? (
      <SidePanel side={side} title={app.label} onClose={() => close(side)}>
        {app.render()}
      </SidePanel>
    ) : null;
  };

  return (
    <div className="wallpaper fixed inset-0 select-none overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-7 bottom-3">
        <div className="pointer-events-auto mx-auto flex h-full max-w-3xl flex-col px-5 pb-3 pt-5">
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div className={`absolute inset-0 overflow-auto ${view === "widget" ? "" : "hidden"}`}>
              <Widgets onOpen={(id) => toggle(sideOf(id), id)} />
            </div>
            <div className={`absolute inset-0 ${view === "terminal" ? "" : "hidden"}`}>
              <CenterTerminal term={term} setHost={setCenterHost} />
            </div>
          </div>
          <CenterNav view={view} onView={setView} />
        </div>
      </div>

      <TopBar />

      <SideDock
        side="left"
        apps={appsOn("left")}
        terms={termsOn("left")}
        activeId={active.left}
        openTermId={openTerm.left}
        onOpen={toggle}
        onOpenTerm={(id) => setOpenTerm((p) => ({ ...p, left: p.left === id ? null : id }))}
        onCloseTerm={term.close}
        onDropApp={(id) => move(id, "left")}
        onDropTerm={(id) => term.moveTo(id, "left")}
      />
      <SideDock
        side="right"
        apps={appsOn("right")}
        terms={termsOn("right")}
        activeId={active.right}
        openTermId={openTerm.right}
        onOpen={toggle}
        onOpenTerm={(id) => setOpenTerm((p) => ({ ...p, right: p.right === id ? null : id }))}
        onCloseTerm={term.close}
        onDropApp={(id) => move(id, "right")}
        onDropTerm={(id) => term.moveTo(id, "right")}
      />

      <AnimatePresence>{renderPanel("left")}</AnimatePresence>
      <AnimatePresence>{renderPanel("right")}</AnimatePresence>

      <TerminalLayer terms={term.terms} activeCenter={term.activeCenter} hosts={hosts} />
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
