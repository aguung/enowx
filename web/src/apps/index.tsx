import { KeyRound, ScrollText, Boxes, Settings, BarChart3, FolderOpen, Flame, KeySquare, Music, Globe, UserCircle, MessagesSquare, ShoppingBag, Newspaper, ShieldCheck } from "lucide-react";
import type { DesktopApp } from "../os/types";
import { AccountsApp } from "./AccountsApp";
import { RequestsApp } from "./RequestsApp";
import { ProvidersApp } from "./ProvidersApp";
import { SettingsApp } from "./SettingsApp";
import { StatisticsApp } from "./StatisticsApp";
import { FilesApp } from "./FilesApp";
import { WarmupLogsApp } from "./WarmupLogsApp";
import { ApiKeysApp } from "./ApiKeysApp";
import { MusicApp } from "./MusicApp";
import { TunnelApp } from "./TunnelApp";
import { ProfileApp } from "./ProfileApp";
import { ChatApp } from "./ChatApp";
import { ShopApp } from "./ShopApp";
import { PostsApp } from "./PostsApp";
import { AdminApp } from "./AdminApp";

// `home` is the default location: a dock side or the Apps drawer. The dock
// starts minimal (core apps); everything else lives in the Apps drawer and the
// user can drag apps in/out. `isMod` gates moderator-only apps (Admin Tools),
// which are also role-gated server-side.
export function buildApps(isMod = false): DesktopApp[] {
  return [
    { id: "providers", label: "Providers", icon: <Boxes />, accent: "from-emerald-500 to-teal-600", home: "left", render: () => <ProvidersApp /> },
    { id: "accounts", label: "Accounts", icon: <KeyRound />, accent: "from-violet-500 to-fuchsia-600", home: "left", render: () => <AccountsApp /> },
    { id: "statistics", label: "Statistics", icon: <BarChart3 />, accent: "from-emerald-500 to-green-700", home: "right", render: () => <StatisticsApp /> },
    { id: "settings", label: "Settings", icon: <Settings />, accent: "from-slate-500 to-slate-700", home: "right", render: () => <SettingsApp /> },
    { id: "files", label: "Files", icon: <FolderOpen />, accent: "from-amber-500 to-orange-600", home: "drawer", render: () => <FilesApp /> },
    { id: "requests", label: "Requests", icon: <ScrollText />, accent: "from-sky-500 to-indigo-600", home: "drawer", render: () => <RequestsApp /> },
    { id: "warmup-logs", label: "Warmup Logs", icon: <Flame />, accent: "from-orange-500 to-red-600", home: "drawer", render: () => <WarmupLogsApp /> },
    { id: "api-keys", label: "API Keys", icon: <KeySquare />, accent: "from-cyan-500 to-blue-600", home: "drawer", render: () => <ApiKeysApp /> },
    { id: "music", label: "Music", icon: <Music />, accent: "from-pink-500 to-rose-600", home: "drawer", render: () => <MusicApp /> },
    { id: "tunnel", label: "Tunnel", icon: <Globe />, accent: "from-blue-500 to-cyan-600", home: "drawer", render: () => <TunnelApp /> },
    { id: "profile", label: "Profile", icon: <UserCircle />, accent: "from-indigo-500 to-violet-600", home: "drawer", render: () => <ProfileApp /> },
    { id: "chat", label: "Community", icon: <MessagesSquare />, accent: "from-fuchsia-500 to-purple-600", home: "drawer", render: () => <ChatApp /> },
    { id: "shop", label: "Shop", icon: <ShoppingBag />, accent: "from-amber-500 to-yellow-600", home: "drawer", render: () => <ShopApp /> },
    { id: "posts", label: "Posts", icon: <Newspaper />, accent: "from-rose-500 to-pink-600", home: "drawer", render: () => <PostsApp /> },
    // Moderator-only; endpoints are role-gated server-side regardless.
    ...(isMod
      ? [{ id: "admin" as const, label: "Admin Tools", icon: <ShieldCheck />, accent: "from-red-500 to-rose-700", home: "drawer" as const, render: () => <AdminApp /> }]
      : []),
  ];
}