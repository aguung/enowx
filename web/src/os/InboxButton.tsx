import { useState } from "react";
import { Mail, ChevronLeft } from "lucide-react";
import { Popover } from "../components/Popover";
import { Markdown } from "../components/Markdown";
import { useProfile } from "./useProfile";
import { useInbox, markInboxRead } from "./inboxBus";
import type { InboxMessage } from "../lib/api";

// InboxButton is the top-bar mail icon + inbox popover (login-gated), sitting
// between the changelog button and the notification bell.
export function InboxButton() {
  const profile = useProfile();
  const { items, unread } = useInbox();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<InboxMessage | null>(null);

  if (!profile.loggedIn) return null;

  const openMsg = (m: InboxMessage) => {
    setMsg(m);
    if (m.unread) markInboxRead(m.id);
  };
  const relTime = (iso: string) => {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} title="Inbox" className="relative flex items-center rounded p-0.5 text-white/70 hover:text-white">
        <Mail className="h-3.5 w-3.5" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <Popover onClose={() => { setOpen(false); setMsg(null); }} anchor="right" valign="down" className="w-80">
          <div className="max-h-96 overflow-hidden rounded-xl border border-white/10 bg-[#0e1016] shadow-2xl">
            {msg ? (
              <div className="max-h-96 overflow-auto">
                <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
                  <button onClick={() => setMsg(null)} className="rounded p-0.5 text-white/40 hover:bg-white/10 hover:text-white"><ChevronLeft className="h-4 w-4" /></button>
                  <span className="truncate text-xs font-semibold text-white">{msg.title}</span>
                </div>
                <div className="px-3 py-2.5">
                  <div className="mb-1.5 text-[10px] text-white/35">from {msg.author_display || msg.author_name} · {relTime(msg.created_at)}</div>
                  <div className="text-xs leading-relaxed text-white/70"><Markdown text={msg.body} /></div>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-white/40">Inbox</span>
                  {unread > 0 && <button onClick={() => markInboxRead()} className="text-[10px] text-white/40 hover:text-white">Mark all read</button>}
                </div>
                {items.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-white/40">No messages.</div>
                ) : (
                  <div className="max-h-80 overflow-auto">
                    {items.map((m) => (
                      <button key={m.id} onClick={() => openMsg(m)} className="flex w-full items-start gap-2 border-b border-white/5 px-3 py-2.5 text-left last:border-0 hover:bg-white/5">
                        {m.unread && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />}
                        <div className={`min-w-0 flex-1 ${m.unread ? "" : "opacity-60"}`}>
                          <div className="truncate text-xs font-medium text-white">{m.title}</div>
                          <div className="truncate text-[10px] text-white/40">{m.author_display || m.author_name} · {relTime(m.created_at)}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </Popover>
      )}
    </div>
  );
}
