import { KeyRound, ScrollText, Boxes, Settings, BarChart3, FolderOpen } from "lucide-react";
import type { DesktopApp } from "../os/types";
import { AccountsApp } from "./AccountsApp";
import { RequestsApp } from "./RequestsApp";
import { ProvidersApp } from "./ProvidersApp";
import { SettingsApp } from "./SettingsApp";
import { StatisticsApp } from "./StatisticsApp";
import { FilesApp } from "./FilesApp";

// Left dock = sources/config, right dock = observation/system.
export function buildApps(): DesktopApp[] {
  return [
    { id: "providers", label: "Providers", icon: <Boxes />, accent: "from-emerald-500 to-teal-600", side: "left", render: () => <ProvidersApp /> },
    { id: "accounts", label: "Accounts", icon: <KeyRound />, accent: "from-violet-500 to-fuchsia-600", side: "left", render: () => <AccountsApp /> },
    { id: "files", label: "Files", icon: <FolderOpen />, accent: "from-amber-500 to-orange-600", side: "left", render: () => <FilesApp /> },
    { id: "statistics", label: "Statistics", icon: <BarChart3 />, accent: "from-emerald-500 to-green-700", side: "right", render: () => <StatisticsApp /> },
    { id: "requests", label: "Requests", icon: <ScrollText />, accent: "from-sky-500 to-indigo-600", side: "right", render: () => <RequestsApp /> },
    { id: "settings", label: "Settings", icon: <Settings />, accent: "from-slate-500 to-slate-700", side: "right", render: () => <SettingsApp /> },
  ];
}
