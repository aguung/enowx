import { useEffect, useRef, useState } from "react";
import { Plus, X, SquareTerminal, ChevronDown, Trash2, UserRound } from "lucide-react";
import type { useTerminals } from "./useTerminals";
import { termProfilesApi, type TermProfile } from "../lib/api";

// CenterTerminal renders the center tab strip + the host div the active
// terminal is portaled into. Tabs can be dragged onto a dock to move a session
// out to the side; dropping a dock terminal here brings it back.
export function CenterTerminal({
  term,
  setHost,
}: {
  term: ReturnType<typeof useTerminals>;
  setHost: (el: HTMLElement | null) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [profiles, setProfiles] = useState<TermProfile[]>([]);
  const reloadProfiles = () => termProfilesApi.list().then((r) => setProfiles(r.profiles ?? [])).catch(() => {});
  useEffect(() => { reloadProfiles(); }, []);
  const centerTerms = term.terms.filter((t) => t.location === "center");

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex shrink-0 items-stretch rounded-t-2xl border border-b-0 border-emerald-500/20 bg-black/40"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("text/term-id")) e.preventDefault();
        }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData("text/term-id");
          if (id) {
            e.preventDefault();
            term.moveTo(Number(id), "center");
          }
        }}
      >
        <div className="term-tabs flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto p-1">
          {centerTerms.map((tab) => {
            const isActive = tab.id === term.activeCenter;
            return (
              <div
                key={tab.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/term-id", String(tab.id));
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => term.setActiveCenter(tab.id)}
                onDoubleClick={() => setEditing(tab.id)}
                title={tab.title}
                className={`group flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                  isActive
                    ? "bg-emerald-500/15 text-emerald-200 ring-1 ring-inset ring-emerald-500/30"
                    : "text-white/45 hover:bg-white/[0.04] hover:text-white/80"
                }`}
              >
                <SquareTerminal className={`h-3.5 w-3.5 shrink-0 ${isActive ? "text-emerald-400" : "text-white/30"}`} />
                {editing === tab.id ? (
                  <input
                    autoFocus
                    defaultValue={tab.title}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      term.rename(tab.id, e.target.value);
                      setEditing(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        term.rename(tab.id, (e.target as HTMLInputElement).value);
                        setEditing(null);
                      } else if (e.key === "Escape") {
                        setEditing(null);
                      }
                    }}
                    className="w-24 bg-transparent font-mono text-xs text-white outline-none"
                  />
                ) : (
                  <span className="max-w-[120px] truncate font-mono">{tab.title}</span>
                )}
                {tab.profile && <ProfileChip slug={tab.profile} profiles={profiles} />}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    term.close(tab.id);
                  }}
                  className={`-mr-0.5 rounded p-0.5 text-white/30 hover:bg-red-500/40 hover:text-white ${
                    isActive ? "opacity-60" : "opacity-0 group-hover:opacity-60"
                  } hover:!opacity-100`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
        <NewTerminalButton onAdd={term.add} profiles={profiles} reloadProfiles={reloadProfiles} />
      </div>

      {/* Terminal instances are portaled into this host by TerminalLayer. */}
      <div ref={setHost} className="relative min-h-0 flex-1 overflow-hidden rounded-b-2xl border border-emerald-500/20 bg-[#0b0c10] shadow-xl" />
    </div>
  );
}

// ProfileChip is the small colored badge on a tab that runs under a profile.
function ProfileChip({ slug, profiles }: { slug: string; profiles: TermProfile[] }) {
  const p = profiles.find((x) => x.slug === slug);
  const color = p?.color || "#8b5cf6";
  return (
    <span
      className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[9px] font-medium"
      style={{ backgroundColor: `${color}22`, color }}
      title={`Profile: ${p?.name ?? slug}`}
    >
      <UserRound className="h-2.5 w-2.5" />
      {p?.name ?? slug}
    </span>
  );
}

// NewTerminalButton opens a plain terminal on click; its caret opens a menu to
// launch under a terminal profile (isolated credentials) or manage profiles.
function NewTerminalButton({
  onAdd,
  profiles,
  reloadProfiles,
}: {
  onAdd: (profile?: string) => void;
  profiles: TermProfile[];
  reloadProfiles: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setCreating(false); } };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    const p = await termProfilesApi.create(n).catch(() => null);
    await reloadProfiles();
    setName(""); setCreating(false); setOpen(false);
    if (p?.slug) onAdd(p.slug);
  };
  const remove = async (slug: string) => {
    await termProfilesApi.remove(slug).catch(() => {});
    reloadProfiles();
  };

  return (
    <div ref={ref} className="relative flex shrink-0 items-stretch border-l border-white/5">
      <button
        onClick={() => onAdd()}
        title="New terminal"
        className="flex items-center px-2.5 text-white/40 transition-colors hover:bg-white/[0.05] hover:text-emerald-300"
      >
        <Plus className="h-4 w-4" />
      </button>
      <button
        onClick={() => setOpen((v) => !v)}
        title="New terminal with a profile"
        className="flex items-center pr-1.5 text-white/30 transition-colors hover:text-emerald-300"
      >
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-[9000] mt-1 w-52 overflow-hidden rounded-lg border border-white/10 bg-[#15161c] py-1 shadow-2xl">
          <div className="px-2.5 py-1 text-[10px] uppercase tracking-wide text-white/30">Terminal profiles</div>
          <button onClick={() => { onAdd(); setOpen(false); }} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-white/75 hover:bg-white/[0.06]">
            <SquareTerminal className="h-3.5 w-3.5 text-white/40" /> Default (no profile)
          </button>
          {profiles.map((p) => (
            <div key={p.slug} className="group flex items-center hover:bg-white/[0.06]">
              <button onClick={() => { onAdd(p.slug); setOpen(false); }} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-xs text-white/75">
                <UserRound className="h-3.5 w-3.5 shrink-0" style={{ color: p.color || "#8b5cf6" }} />
                <span className="truncate">{p.name}</span>
              </button>
              <button onClick={() => remove(p.slug)} title="Delete profile" className="mr-1 shrink-0 rounded p-1 text-white/25 opacity-0 hover:bg-red-500/30 hover:text-red-200 group-hover:opacity-100">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
          <div className="mt-1 border-t border-white/5 pt-1">
            {creating ? (
              <div className="flex items-center gap-1 px-2 py-1">
                <input
                  autoFocus value={name} onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") create(); if (e.key === "Escape") setCreating(false); }}
                  placeholder="Profile name…"
                  className="w-full rounded border border-white/10 bg-black/30 px-1.5 py-1 text-xs text-white/80 outline-none focus:border-white/25"
                />
                <button onClick={create} className="rounded bg-white px-2 py-1 text-[11px] font-medium text-black hover:opacity-90">Add</button>
              </div>
            ) : (
              <button onClick={() => setCreating(true)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-emerald-300/80 hover:bg-white/[0.06]">
                <Plus className="h-3.5 w-3.5" /> New profile
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
