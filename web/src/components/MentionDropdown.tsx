import type { SearchUserHit } from "../lib/api";

// MentionDropdown renders the @mention autocomplete suggestions above a composer.
export function MentionDropdown({ items, active, onPick }: { items: SearchUserHit[]; active: number; onPick: (u: SearchUserHit) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="absolute bottom-full left-0 z-20 mb-1 w-64 overflow-hidden rounded-lg border border-white/10 bg-[#14161d] shadow-xl">
      {items.map((u, i) => (
        <button
          key={u.id}
          onMouseDown={(e) => { e.preventDefault(); onPick(u); }}
          className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left ${i === active ? "bg-white/10" : "hover:bg-white/5"}`}
        >
          {u.avatar_url ? <img src={u.avatar_url} alt="" className="h-6 w-6 rounded-full" /> : <div className="h-6 w-6 rounded-full bg-white/10" />}
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-white">{u.display_name || u.username}</div>
            <div className="truncate text-[10px] text-white/40">@{u.username}</div>
          </div>
        </button>
      ))}
    </div>
  );
}
