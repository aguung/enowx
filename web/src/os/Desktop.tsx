import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { LayoutGrid, SquareTerminal, BookOpen, Grid3x3, Bot, FlaskConical } from "lucide-react";
import { buildApps } from "../apps";
import { SideDock } from "./SideDock";
import { SidePanel } from "./SidePanel";
import { TopBar } from "./TopBar";
import { Widgets } from "./Widgets";
import { CenterTerminal } from "./CenterTerminal";
import { TerminalLayer } from "./TerminalLayer";
import { AppsDrawer } from "./AppsDrawer";
import { Tooltip } from "../components/Tooltip";
import { ProfileViewer } from "../apps/ProfileViewer";
import { Lightbox } from "../components/Lightbox";
import { useProfile } from "./useProfile";
import { DocsApp } from "../apps/DocsApp";
import { AiChatApp } from "../apps/AiChatApp";
import { ApiTestApp } from "../apps/ApiTestApp";
import { usePanels } from "./usePanels";
import { usePersisted } from "./usePersisted";
import { useAppLocations } from "./useSides";
import { useShortcuts } from "./useShortcuts";
import { useTerminals, type TermLocation } from "./useTerminals";
import type { AppId, Location, Side } from "./types";

type CenterView = "widget" | "terminal" | "chat" | "apitest" | "apps" | "docs";

export function Desktop() {
  const profile = useProfile();
  const apps = buildApps(profile.has("chat.moderate"));
  const { active, toggle, close } = usePanels();
  const [view, setView] = usePersisted<CenterView>("center-view", "widget");

  const defaults = Object.fromEntries(apps.map((a) => [a.id, a.home])) as Record<AppId, Location>;
  const { locations, move } = useAppLocations(defaults);
  const term = useTerminals();

  // Per-location DOM hosts the terminal instances are portaled into.
  const [centerHost, setCenterHost] = useState<HTMLElement | null>(null);
  const [leftHost, setLeftHost] = useState<HTMLElement | null>(null);
  const [rightHost, setRightHost] = useState<HTMLElement | null>(null);
  const hosts: Record<TermLocation, HTMLElement | null> = { center: centerHost, left: leftHost, right: rightHost };

  const locationOf = (id: AppId): Location => locations[id] ?? "drawer";
  const appsOn = (side: Side) => apps.filter((a) => locationOf(a.id) === side);
  const drawerApps = apps.filter((a) => locationOf(a.id) === "drawer");
  const termsOn = (side: Side) => term.terms.filter((t) => t.location === side);
  const findApp = (id: AppId | null) => apps.find((a) => a.id === id);

  // A dock side may have an app panel open OR a terminal panel open.
  const [openTerm, setOpenTerm] = usePersisted<Record<Side, number | null>>("open-term", { left: null, right: null });
  const openTermOn = (side: Side) => term.terms.find((t) => t.location === side && t.id === openTerm[side]) ?? null;

  // Open an app from anywhere: if docked, toggle its panel; if in the drawer,
  // pin it to the left dock and open it.
  const openApp = (id: AppId) => {
    const loc = locationOf(id);
    if (loc === "drawer") {
      move(id, "left");
      toggle("left", id);
    } else {
      toggle(loc, id);
    }
  };

  // Leader-key shortcuts: 1..4 switch the center view; a letter opens an app.
  const appShortcuts: Record<string, AppId> = {
    p: "providers",
    a: "accounts",
    s: "statistics",
    g: "settings",
    f: "files",
    r: "requests",
    w: "warmup-logs",
    k: "api-keys",
    m: "music",
    t: "tunnel",
    c: "profile",
  };
  const leaderActive = useShortcuts((k) => {
    const v: Record<string, CenterView> = { "1": "widget", "2": "terminal", "3": "chat", "4": "apitest", "5": "apps", "6": "docs" };
    if (v[k]) {
      setView(v[k]);
      return;
    }
    if (appShortcuts[k]) openApp(appShortcuts[k]);
  });

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
    return app && id && locationOf(id) === side ? (
      <SidePanel side={side} title={app.label} onClose={() => close(side)}>
        {app.render()}
      </SidePanel>
    ) : null;
  };

  return (
    <div className="wallpaper fixed inset-0 select-none overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-7 bottom-3">
        <div className="pointer-events-auto mx-auto flex h-full max-w-3xl flex-col px-5 pb-2 pt-3">
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div className={`absolute inset-0 overflow-auto ${view === "widget" ? "" : "hidden"}`}>
              <Widgets onOpen={openApp} />
            </div>
            <div className={`absolute inset-0 ${view === "terminal" ? "" : "hidden"}`}>
              <CenterTerminal term={term} setHost={setCenterHost} />
            </div>
            <div className={`absolute inset-0 ${view === "chat" ? "" : "hidden"}`}>
              <AiChatApp />
            </div>
            <div className={`absolute inset-0 ${view === "apitest" ? "" : "hidden"}`}>
              <ApiTestApp />
            </div>
            <div className={`absolute inset-0 ${view === "apps" ? "" : "hidden"}`}>
              <AppsDrawer apps={drawerApps} onOpen={openApp} onDropToDrawer={(id) => move(id, "drawer")} />
            </div>
            <div className={`absolute inset-0 overflow-hidden rounded-2xl border border-white/10 bg-[var(--window-bg)]/80 ${view === "docs" ? "" : "hidden"}`}>
              <DocsApp />
            </div>
          </div>
        </div>
      </div>

      <TopBar nav={<CenterNav view={view} onView={setView} />} />

      {/* Full-page profile overlay (opened via openProfile from anywhere). */}
      <ProfileViewer />
      {/* Image lightbox overlay (opened from any thumbnail). */}
      <Lightbox />

      {leaderActive && (
        <div className="pointer-events-none fixed left-1/2 top-9 z-[10000] -translate-x-1/2 rounded-lg border border-emerald-500/30 bg-black/80 px-3 py-1.5 font-mono text-[11px] text-emerald-300 shadow-lg">
          hold + press: 1 widget · 2 terminal · 3 chat · 4 api · 5 apps · 6 docs · p a s g f r w k m t c apps
        </div>
      )}

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

// Compact center-view switch that lives in the top bar. The leader-key hint is
// shown in each tab's tooltip (tap Ctrl/Alt then the number).
function CenterNav({ view, onView }: { view: CenterView; onView: (v: CenterView) => void }) {
  const tabs: { id: CenterView; label: string; icon: typeof LayoutGrid; key: string }[] = [
    { id: "widget", label: "Widget", icon: LayoutGrid, key: "1" },
    { id: "terminal", label: "Terminal", icon: SquareTerminal, key: "2" },
    { id: "chat", label: "Chat", icon: Bot, key: "3" },
    { id: "apitest", label: "API Test", icon: FlaskConical, key: "4" },
    { id: "apps", label: "Apps", icon: Grid3x3, key: "5" },
    { id: "docs", label: "Docs", icon: BookOpen, key: "6" },
  ];
  return (
    <div className="flex items-center gap-0.5">
      {tabs.map((t) => {
        const Icon = t.icon;
        return (
          <Tooltip key={t.id} label={`${t.label} · hold Ctrl/Alt + ${t.key}`} place="bottom">
            <button
              onClick={() => onView(t.id)}
              className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                view === t.id ? "bg-white/12 text-white" : "text-white/45 hover:text-white/80"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
