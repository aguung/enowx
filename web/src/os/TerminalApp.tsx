import { useRef, useState } from "react";
import { Plus, X, SquareTerminal } from "lucide-react";
import { TerminalView } from "./TerminalView";

interface Tab {
  id: number;
  title: string;
}

// TerminalApp manages multiple PTY terminal tabs. Inactive tabs stay mounted
// (hidden) so their shell session keeps running while you switch around.
export function TerminalApp() {
  const seq = useRef(1);
  const [tabs, setTabs] = useState<Tab[]>([{ id: 0, title: "terminal" }]);
  const [activeId, setActiveId] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);

  const add = () => {
    const id = seq.current++;
    setTabs((t) => [...t, { id, title: `terminal ${id + 1}` }]);
    setActiveId(id);
  };

  const close = (id: number) => {
    setTabs((t) => {
      const next = t.filter((x) => x.id !== id);
      if (next.length === 0) {
        const fresh = { id: seq.current++, title: "terminal" };
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) setActiveId(next[next.length - 1].id);
      return next;
    });
  };

  const rename = (id: number, title: string) => {
    setTabs((t) => t.map((x) => (x.id === id ? { ...x, title: title.trim() || x.title } : x)));
  };

  return (
    <div className="flex h-full flex-col">
      {/* Editor-style tab strip that sits on top of the terminal body. */}
      <div className="flex shrink-0 items-stretch rounded-t-2xl border border-b-0 border-emerald-500/20 bg-black/40">
        <div className="term-tabs flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto p-1">
          {tabs.map((tab) => {
            const isActive = tab.id === activeId;
            return (
              <div
                key={tab.id}
                onClick={() => setActiveId(tab.id)}
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
                      rename(tab.id, e.target.value);
                      setEditing(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        rename(tab.id, (e.target as HTMLInputElement).value);
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
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    close(tab.id);
                  }}
                  className={`-mr-0.5 rounded p-0.5 text-white/30 transition-opacity hover:bg-red-500/40 hover:text-white ${
                    isActive ? "opacity-60" : "opacity-0 group-hover:opacity-60"
                  } hover:!opacity-100`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
        <button
          onClick={add}
          title="New terminal"
          className="flex shrink-0 items-center border-l border-white/5 px-2.5 text-white/40 transition-colors hover:bg-white/[0.05] hover:text-emerald-300"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-b-2xl border border-emerald-500/20 bg-[#0b0c10] shadow-xl">
        {tabs.map((tab) => (
          <div key={tab.id} className={`absolute inset-0 ${tab.id === activeId ? "" : "hidden"}`}>
            <TerminalView />
          </div>
        ))}
      </div>
    </div>
  );
}
