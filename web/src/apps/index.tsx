import { KeyRound, ScrollText, Boxes, Settings, BarChart3, FolderOpen, Flame, KeySquare } from "lucide-react";
import type { DesktopApp } from "../os/types";
import { AccountsApp } from "./AccountsApp";
import { RequestsApp } from "./RequestsApp";
import { ProvidersApp } from "./ProvidersApp";
import { SettingsApp } from "./SettingsApp";
import { StatisticsApp } from "./StatisticsApp";
import { FilesApp } from "./FilesApp";
import { WarmupLogsApp } from "./WarmupLogsApp";
import { ApiKeysApp } from "./ApiKeysApp";

// `home` is the default location: a dock side or the Apps drawer. The dock
// starts minimal (core apps); everything else lives in the Apps drawer and the
// user can drag apps in/out.
export function buildApps(): DesktopApp[] {
  return [
    { id: "providers", label: "Providers", icon: <Boxes />, accent: "from-emerald-500 to-teal-600", home: "left", render: () => <ProvidersApp /> },
    { id: "accounts", label: "Accounts", icon: <KeyRound />, accent: "from-violet-500 to-fuchsia-600", home: "left", render: () => <AccountsApp /> },
    { id: "statistics", label: "Statistics", icon: <BarChart3 />, accent: "from-emerald-500 to-green-700", home: "right", render: () => <StatisticsApp /> },
    { id: "settings", label: "Settings", icon: <Settings />, accent: "from-slate-500 to-slate-700", home: "right", render: () => <SettingsApp /> },
    { id: "files", label: "Files", icon: <FolderOpen />, accent: "from-amber-500 to-orange-600", home: "drawer", render: () => <FilesApp /> },
    { id: "requests", label: "Requests", icon: <ScrollText />, accent: "from-sky-500 to-indigo-600", home: "drawer", render: () => <RequestsApp /> },
    { id: "warmup-logs", label: "Warmup Logs", icon: <Flame />, accent: "from-orange-500 to-red-600", home: "drawer", render: () => <WarmupLogsApp /> },
    { id: "api-keys", label: "API Keys", icon: <KeySquare />, accent: "from-cyan-500 to-blue-600", home: "drawer", render: () => <ApiKeysApp /> },
  ];
}