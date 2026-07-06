import { useEffect, useState } from "react";
import { Folder, FileText, ArrowUp, Home, Plus, X, Copy, Check, MoreVertical } from "lucide-react";
import { AppShell } from "./shell";
import { filesApi, type DirListing } from "../lib/api";
import { fileKind } from "../os/fileKind";
import { FileViewer } from "./FileViewer";
import { useFileTabs } from "./useFileTabs";
import { copyText } from "../os/clipboard";
import { useContextMenu, type MenuItem } from "../os/contextmenu";

// relativeTo returns `full` expressed relative to `home` (e.g. "~/foo/bar"), or
// the absolute path if it isn't under home.
function relativeTo(full: string, home: string | undefined): string {
  if (!home) return full;
  const h = home.replace(/\/+$/, "");
  if (full === h) return "~";
  if (full.startsWith(h + "/")) return "~/" + full.slice(h.length + 1);
  return full;
}

const fmtSize = (n: number) =>
  n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : n >= 1 << 10 ? `${(n / (1 << 10)).toFixed(1)} KB` : `${n} B`;

function join(dir: string, name: string) {
  return dir.endsWith("/") ? dir + name : dir + "/" + name;
}

function basename(p: string | null) {
  if (!p) return "Home";
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || "/";
}

export function FilesApp() {
  const { tabs, activeId, setActive, add, close, setPath } = useFileTabs();

  return (
    <AppShell title="Files" subtitle="Local file browser">
      <div className="flex h-full flex-col">
        <div className="mb-2 flex shrink-0 items-stretch rounded-xl border border-white/10 bg-black/30">
          <div className="term-tabs flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto p-1">
            {tabs.map((tab) => {
              const isActive = tab.id === activeId;
              return (
                <div
                  key={tab.id}
                  onClick={() => setActive(tab.id)}
                  title={tab.path ?? "Home"}
                  className={`group flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition-colors ${
                    isActive ? "bg-amber-500/15 text-amber-200 ring-1 ring-inset ring-amber-500/30" : "text-white/45 hover:bg-white/[0.04] hover:text-white/80"
                  }`}
                >
                  <Folder className={`h-3.5 w-3.5 shrink-0 ${isActive ? "text-amber-300" : "text-white/30"}`} />
                  <span className="max-w-[120px] truncate font-mono">{basename(tab.path)}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      close(tab.id);
                    }}
                    className={`-mr-0.5 rounded p-0.5 text-white/30 hover:bg-red-500/40 hover:text-white ${isActive ? "opacity-60" : "opacity-0 group-hover:opacity-60"} hover:!opacity-100`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
          <button
            onClick={add}
            title="New tab"
            className="flex shrink-0 items-center border-l border-white/5 px-2.5 text-white/40 transition-colors hover:bg-white/[0.05] hover:text-amber-300"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {tabs.map((tab) =>
          tab.id === activeId ? (
            <FileBrowser key={tab.id} path={tab.path} onPath={(p) => setPath(tab.id, p)} />
          ) : null,
        )}
      </div>
    </AppShell>
  );
}

interface Viewing {
  path: string;
  name: string;
  kind: "text" | "image";
}

function FileBrowser({ path, onPath }: { path: string | null; onPath: (p: string | null) => void }) {
  const [dir, setDir] = useState<DirListing | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [copiedDir, setCopiedDir] = useState(false);
  const [pathEdit, setPathEdit] = useState<string | null>(null); // null = showing dir.path; string = user is typing
  const menu = useContextMenu();

  // Build the copy menu for an entry (or the current dir when full == dir.path).
  const pathMenu = (full: string): MenuItem[] => [
    { label: "Copy path", icon: <Copy className="h-3.5 w-3.5" />, onClick: () => copyText(full) },
    { label: "Copy relative path", icon: <Copy className="h-3.5 w-3.5" />, onClick: () => copyText(relativeTo(full, dir?.home)) },
  ];

  useEffect(() => {
    let alive = true;
    // reload re-lists the directory without toggling the loading spinner (used by
    // the live watcher so external changes don't flash the whole view).
    const reload = (spin: boolean) => {
      if (spin) setLoading(true);
      filesApi
        .list(path ?? undefined)
        .then((d) => {
          if (!alive) return;
          setDir(d);
          setError("");
        })
        .catch((e) => alive && setError(e instanceof Error ? e.message : "failed to read"))
        .finally(() => alive && spin && setLoading(false));
    };
    reload(true);

    // Live-refresh: subscribe to filesystem changes for this directory so folders
    // created/removed externally (e.g. from a terminal) appear without a manual
    // refresh. Debounced server-side; we just re-list on each "change".
    const es = new EventSource(filesApi.watchUrl(path ?? undefined));
    es.addEventListener("change", () => reload(false));
    return () => {
      alive = false;
      es.close();
    };
  }, [path]);

  // Navigating to another directory drops any open file view.
  useEffect(() => setViewing(null), [path]);

  if (viewing) {
    return <FileViewer path={viewing.path} name={viewing.name} kind={viewing.kind} onBack={() => setViewing(null)} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center gap-1.5">
        <IconBtn onClick={() => onPath(dir?.home ?? null)} title="Home">
          <Home className="h-3.5 w-3.5" />
        </IconBtn>
        <IconBtn onClick={() => dir?.parent && onPath(dir.parent)} title="Up" disabled={!dir?.parent}>
          <ArrowUp className="h-3.5 w-3.5" />
        </IconBtn>
        <input
          value={pathEdit ?? dir?.path ?? ""}
          placeholder="Type or paste a path… (Enter to go)"
          spellCheck={false}
          onChange={(e) => setPathEdit(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const p = (pathEdit ?? "").trim();
              if (p) onPath(p);
              setPathEdit(null);
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setPathEdit(null);
              e.currentTarget.blur();
            }
          }}
          onBlur={() => setPathEdit(null)}
          onContextMenu={(e) => dir && menu.show(e, pathMenu(dir.path))}
          className="ml-1 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 font-mono text-[11px] text-white/70 outline-none focus:border-amber-500/40 focus:text-white"
        />
        <IconBtn
          onClick={() => {
            if (!dir) return;
            copyText(dir.path);
            setCopiedDir(true);
            setTimeout(() => setCopiedDir(false), 1200);
          }}
          title="Copy directory path"
          disabled={!dir}
        >
          {copiedDir ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
        </IconBtn>
      </div>

      {error && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

      {loading ? (
        <div className="h-40 animate-pulse rounded-lg bg-white/5" />
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-white/10">
          {dir?.entries.length === 0 ? (
            <div className="p-6 text-center text-xs text-white/40">Empty folder</div>
          ) : (
            <div className="h-full divide-y divide-white/5 overflow-auto">
              {dir?.entries.map((e) => {
                const full = join(dir.path, e.name);
                const open = () => (e.is_dir ? onPath(full) : setViewing({ path: full, name: e.name, kind: fileKind(e.name) }));
                return (
                  <div
                    key={e.name}
                    onDoubleClick={open}
                    onContextMenu={(ev) => menu.show(ev, pathMenu(full))}
                    className="group/row flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors hover:bg-white/[0.04]"
                  >
                    {e.is_dir ? <Folder className="h-4 w-4 shrink-0 text-sky-300/80" /> : <FileText className="h-4 w-4 shrink-0 text-white/40" />}
                    <span className="min-w-0 flex-1 truncate text-white/80">{e.name}</span>
                    {!e.is_dir && <span className="shrink-0 tabular-nums text-white/30">{fmtSize(e.size)}</span>}
                    <span className="hidden shrink-0 text-white/25 sm:inline">{e.mod}</span>
                    <button
                      onClick={(ev) => { ev.stopPropagation(); menu.show(ev, pathMenu(full)); }}
                      title="Actions"
                      className="-mr-1 shrink-0 rounded p-0.5 text-white/30 opacity-0 transition-opacity hover:bg-white/10 hover:text-white group-hover/row:opacity-100"
                    >
                      <MoreVertical className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IconBtn({
  onClick,
  title,
  disabled,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
    >
      {children}
    </button>
  );
}
