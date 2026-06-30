import type { ReactNode } from "react";

export type AppId =
  | "accounts"
  | "requests"
  | "providers"
  | "settings"
  | "statistics"
  | "files"
  | "warmup-logs"
  | "api-keys"
  | "music"
  | "tunnel"
  | "profile";

export type Side = "left" | "right";

// Where an app currently lives: a dock edge, or the Apps drawer (not docked).
export type Location = Side | "drawer";

export interface DesktopApp {
  id: AppId;
  label: string;
  icon: ReactNode;
  accent: string; // tailwind gradient classes
  home: Location; // default location (dock side or drawer)
  render: () => ReactNode;
}
