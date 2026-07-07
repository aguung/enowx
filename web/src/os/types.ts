import type { ReactNode } from "react";

// Known built-in apps. Plugins add dynamic ids ("plugin:<id>"), so AppId also
// accepts any string while keeping autocomplete for the built-ins.
export type KnownAppId =
  | "accounts"
  | "requests"
  | "providers"
  | "settings"
  | "statistics"
  | "files"
  | "warmup-logs"
  | "api-keys"
  | "music"
  | "plugins"
  | "filters"
  | "tunnel"
  | "profile"
  | "chat"
  | "shop"
  | "posts"
  | "integrations"
  | "mitm"
  | "admin";

// eslint-disable-next-line @typescript-eslint/ban-types
export type AppId = KnownAppId | (string & {});

export type Side = "left" | "right";

// Where an app currently lives: a dock edge, or the Apps drawer (not docked).
export type Location = Side | "drawer";

export interface DesktopApp {
  id: AppId;
  label: string;
  icon: ReactNode;
  accent: string; // tailwind gradient classes
  home: Location; // default location (dock side or drawer)
  badge?: string; // small text tag shown on the icon (e.g. "plugin")
  notify?: boolean; // red unread dot on the icon (e.g. new community chat)
  render: () => ReactNode;
}
