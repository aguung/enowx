import { KeyRound, ScrollText, Boxes, Settings, BarChart3, FolderOpen, Flame, KeySquare, Music, Globe, UserCircle, MessagesSquare, ShoppingBag, Newspaper, Puzzle, Shuffle, Network } from "lucide-react";
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
import { PluginsApp } from "./PluginsApp";
import { FiltersApp } from "./FiltersApp";
import { ProxyApp } from "./ProxyApp";

// `home` is the default location: a dock side or the Apps drawer. The dock
// starts minimal (core apps); everything else lives in the Apps drawer and the
// user can drag apps in/out.
export function buildApps(): DesktopApp[] {
  return [
    // Left dock: the "make the proxy work" core + personal/social identity.
    { id: "providers", label: "Providers", icon: <Boxes />, accent: "from-emerald-500 to-teal-600", home: "left", render: () => <ProvidersApp /> },
    { id: "accounts", label: "Accounts", icon: <KeyRound />, accent: "from-violet-500 to-fuchsia-600", home: "left", render: () => <AccountsApp /> },
    { id: "api-keys", label: "API Keys", icon: <KeySquare />, accent: "from-cyan-500 to-blue-600", home: "left", render: () => <ApiKeysApp /> },
    { id: "plugins", label: "Plugins", icon: <Puzzle />, accent: "from-violet-500 to-purple-600", home: "left", render: () => <PluginsApp /> },
    { id: "profile", label: "Profile", icon: <UserCircle />, accent: "from-indigo-500 to-violet-600", home: "left", render: () => <ProfileApp /> },
    { id: "posts", label: "Posts", icon: <Newspaper />, accent: "from-rose-500 to-pink-600", home: "left", render: () => <PostsApp /> },
    // Right dock: monitoring, community, and config.
    { id: "statistics", label: "Statistics", icon: <BarChart3 />, accent: "from-emerald-500 to-green-700", home: "right", render: () => <StatisticsApp /> },
    { id: "requests", label: "Requests", icon: <ScrollText />, accent: "from-sky-500 to-indigo-600", home: "right", render: () => <RequestsApp /> },
    { id: "music", label: "Music", icon: <Music />, accent: "from-pink-500 to-rose-600", home: "right", render: () => <MusicApp /> },
    { id: "chat", label: "Community", icon: <MessagesSquare />, accent: "from-fuchsia-500 to-purple-600", home: "right", render: () => <ChatApp /> },
    { id: "settings", label: "Settings", icon: <Settings />, accent: "from-slate-500 to-slate-700", home: "right", render: () => <SettingsApp /> },
    // Drawer: everything situational (open from the Apps drawer or drag onto a dock).
    { id: "files", label: "Files", icon: <FolderOpen />, accent: "from-amber-500 to-orange-600", home: "drawer", render: () => <FilesApp /> },
    { id: "warmup-logs", label: "Warmup Logs", icon: <Flame />, accent: "from-orange-500 to-red-600", home: "drawer", render: () => <WarmupLogsApp /> },
    { id: "filters", label: "Filters", icon: <Shuffle />, accent: "from-teal-500 to-emerald-600", home: "drawer", render: () => <FiltersApp /> },
    { id: "proxy", label: "Proxy", icon: <Network />, accent: "from-cyan-500 to-sky-700", home: "drawer", render: () => <ProxyApp /> },
    { id: "tunnel", label: "Tunnel", icon: <Globe />, accent: "from-blue-500 to-cyan-600", home: "drawer", render: () => <TunnelApp /> },
    { id: "shop", label: "Shop", icon: <ShoppingBag />, accent: "from-amber-500 to-yellow-600", home: "drawer", render: () => <ShopApp /> },
    // Admin is a moderator-only center view (see Desktop), not a docked app.
  ];
}