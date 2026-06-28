import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
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
    <div className="flex h-full flex-col gap-2">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => setActiveId(tab.id)}
            onDoubleClick={() => setEditing(tab.id)}
            className={`group flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
              tab.id === activeId
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                : "border-white/10 bg-white/[0.03] text-white/60 hover:text-white/90"
            }`}
          >
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
              <span className="font-mono">{tab.title}</span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                close(tab.id);
              }}
              className="rounded p-0.5 text-white/30 opacity-0 transition-opacity hover:bg-red-500/40 hover:text-white group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <button
          onClick={add}
          title="New terminal"
          className="shrink-0 rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-white/50 hover:text-white"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <div key={tab.id} className={`absolute inset-0 ${tab.id === activeId ? "" : "hidden"}`}>
            <TerminalView />
          </div>
        ))}
      </div>
    </div>
  );
}
