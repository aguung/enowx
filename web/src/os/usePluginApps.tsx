import { useEffect, useRef, useState } from "react";
import { Loader2, AlertTriangle, Puzzle } from "lucide-react";
import { pluginsApi, type PluginManifest } from "../lib/api";
// pluginsApi.iconUrl builds the icon image URL for a plugin.
import type { DesktopApp } from "./types";

// PLUGIN_PREFIX namespaces plugin app ids so they never collide with built-ins.
export const PLUGIN_PREFIX = "plugin:";

// PluginFrame shows a plugin's UI directly. If its sidecar isn't running it
// auto-starts it (no manual button), showing a brief loading state, then loads
// the UI from /plugins/<id>/.
function PluginFrame({ plugin }: { plugin: PluginManifest }) {
  const isStatic = plugin.runtime === "static";
  const [ready, setReady] = useState(isStatic || !!plugin.running);
  const [err, setErr] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (ready || started.current) return;
    started.current = true;
    (async () => {
      try {
        await pluginsApi.start(plugin.id);
        // Give the sidecar a moment to bind its port before loading the iframe.
        setTimeout(() => setReady(true), 600);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "failed to start plugin");
      }
    })();
  }, [ready, plugin.id]);

  if (err) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-white/60">
        <AlertTriangle className="h-7 w-7 text-red-400/80" />
        <p className="text-sm">Couldn't start {plugin.name}.</p>
        <p className="text-xs text-red-300">{err}</p>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-white/50">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-xs">Starting {plugin.name}…</p>
      </div>
    );
  }
  return (
    <iframe
      title={plugin.name}
      src={`/plugins/${plugin.id}/`}
      className="h-full w-full bg-[#0b0d12]"
      sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
    />
  );
}

// usePluginApps fetches installed plugins and exposes them as DesktopApps so they
// appear in the WebOS drawer/dock with a "plugin" badge. Refreshes on focus so a
// newly-created plugin shows up.
export function usePluginApps(): DesktopApp[] {
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  useEffect(() => {
    const load = () => pluginsApi.list().then((r) => setPlugins(r.plugins ?? [])).catch(() => {});
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, []);

  return plugins.map((p) => ({
    id: PLUGIN_PREFIX + p.id,
    label: p.name,
    // Custom icon image (auto-fit to the icon box) when the plugin has one; else
    // the default puzzle glyph.
    icon: p.has_icon ? (
      <img src={pluginsApi.iconUrl(p.id)} alt="" className="!h-full !w-full rounded-xl object-cover" />
    ) : (
      <Puzzle />
    ),
    accent: "from-violet-500 to-purple-600",
    home: "drawer" as const,
    badge: "plugin",
    render: () => <PluginFrame plugin={p} />,
  }));
}
