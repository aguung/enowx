import type { ReactNode } from "react";

export type AppId = "accounts" | "requests" | "providers" | "settings" | "statistics" | "files";

export type Side = "left" | "right";

export interface DesktopApp {
  id: AppId;
  label: string;
  icon: ReactNode;
  accent: string; // tailwind gradient classes
  side: Side; // which edge dock + slide panel this app lives on
  render: () => ReactNode;
}
