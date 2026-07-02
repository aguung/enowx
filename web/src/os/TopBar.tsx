import { useEffect, useState, type ReactNode } from "react";
import { SystemStats } from "./SystemStats";
import { TopBarNowPlaying } from "./TopBarNowPlaying";
import { NotifBell } from "./NotifBell";
import { ChangelogButton } from "./ChangelogButton";

export function TopBar({ nav }: { nav?: ReactNode }) {
  const [clock, setClock] = useState("--:--");
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const date = d.toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short" });
      const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setClock(`${date} ${time}`);
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="glass absolute inset-x-0 top-0 z-[9999] flex h-7 items-center gap-3 border-b border-white/5 bg-[var(--topbar-bg)] px-3 text-[11px] text-white/85">
      <span className="shrink-0 font-semibold tracking-wide">enowx</span>
      {nav}
      <TopBarNowPlaying />
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <ChangelogButton />
        <NotifBell />
        <SystemStats />
        <span className="tabular-nums text-white/70">{clock}</span>
      </div>
    </div>
  );
}
