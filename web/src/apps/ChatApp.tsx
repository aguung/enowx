import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Wifi, WifiOff, Pencil, Trash2, Copy, Reply, X, SmilePlus, ShieldCheck } from "lucide-react";
import { AppShell } from "./shell";
import { Popover } from "../components/Popover";
import { ProfileCard } from "../components/ProfileCard";
import { EmojiPicker } from "../components/EmojiPicker";
import { useProfile } from "../os/useProfile";
import { useChat, sendChat, editChat, deleteChat, reactChat, loadChannel } from "../os/chatBus";
import { useDialog } from "../os/dialog";
import { openProfile } from "../os/profileViewer";
import { profileApi, modApi, type ChatMessage, type PublicProfile } from "../lib/api";

interface ReplyTarget {
  id: number;
  author: string;
  content: string;
}

// ChatApp is the community chat: a single global channel. Messages stream in
// live (SSE); clicking an author opens their profile card. Login-gated.
export function ChatApp() {
  const profile = useProfile();
  if (!profile.loggedIn) {
    return (
      <AppShell title="Community" subtitle="Chat with other members">
        <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm text-white/60">Sign in to join the community chat.</p>
          <p className="text-[11px] text-white/35">Open the Profile app to connect Discord.</p>
        </div>
      </AppShell>
    );
  }
  return (
    <AppShell title="Community" subtitle="Channels" flush>
      <ChatRoom />
    </AppShell>
  );
}

function ChatRoom() {
  const { messages, channels, channel, loading, connected } = useChat();
  const profile = useProfile();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [reply, setReply] = useState<ReplyTarget | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to the newest message.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const myUsername = profile.user?.username;
  const canModerate = profile.has("chat.moderate");

  function startReply(m: ChatMessage) {
    setReply({ id: m.id, author: m.display_name || m.username, content: m.content });
    inputRef.current?.focus();
  }

  async function submit() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await sendChat(text, reply?.id);
      setDraft("");
      setReply(null);
    } catch {
      /* keep the draft so the user can retry */
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Channel tabs */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-white/5 px-3 py-1.5">
        {channels.map((c) => (
          <button
            key={c.key}
            onClick={() => loadChannel(c.key)}
            className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${c.key === channel ? "bg-white/15 text-white" : "text-white/50 hover:bg-white/5 hover:text-white"}`}
          >
            #{c.label}
          </button>
        ))}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 px-1 text-[10px] uppercase tracking-wide text-white/30">
          {connected ? <Wifi className="h-3 w-3 text-emerald-400/70" /> : <WifiOff className="h-3 w-3 text-white/30" />}
          {connected ? "live" : "…"}
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-auto px-2 py-3">
        {loading && messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-white/30" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-white/40">No messages yet — say hi 👋</div>
        ) : (
          messages.map((m) => (
            <MessageRow
              key={m.id}
              m={m}
              mine={!!myUsername && m.username === myUsername}
              canModerate={canModerate}
              onOpenUser={() => setOpenUser(m.user_id)}
              open={openUser === m.user_id}
              onClose={() => setOpenUser(null)}
              onReply={() => startReply(m)}
            />
          ))
        )}
        <div ref={endRef} />
      </div>

      {reply && (
        <div className="mx-4 flex items-center justify-between gap-2 rounded-t-lg border-x border-t border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px]">
          <span className="min-w-0 truncate text-white/50">
            Replying to <span className="text-white/70">{reply.author}</span> · <span className="text-white/40">{reply.content}</span>
          </span>
          <button onClick={() => setReply(null)} className="rounded p-0.5 text-white/40 hover:bg-white/10 hover:text-white">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="flex items-center gap-2 border-t border-white/5 px-4 py-3">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), submit())}
          placeholder={reply ? `Reply to ${reply.author}` : `Message #${channel}`}
          maxLength={1000}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
        />
        <button
          onClick={submit}
          disabled={sending || !draft.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-500/90 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

function MessageRow({
  m,
  mine,
  canModerate,
  onOpenUser,
  open,
  onClose,
  onReply,
}: {
  m: ChatMessage;
  mine: boolean;
  canModerate: boolean;
  onOpenUser: () => void;
  open: boolean;
  onClose: () => void;
  onReply: () => void;
}) {
  const dialog = useDialog();
  const name = m.display_name || m.username;
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(m.content);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function react(emoji: string) {
    setPickerOpen(false);
    try {
      await reactChat(m.id, emoji);
    } catch {
      /* ignore */
    }
  }

  async function saveEdit() {
    const t = editText.trim();
    if (!t || t === m.content) {
      setEditing(false);
      return;
    }
    try {
      await editChat(m.id, t);
    } catch {
      /* leave editing open on failure */
      return;
    }
    setEditing(false);
  }

  async function doDelete() {
    const ok = await dialog.confirm({ title: "Delete message?", message: "This can't be undone.", confirmLabel: "Delete" });
    if (!ok) return;
    try {
      await deleteChat(m.id);
    } catch {
      /* ignore; broadcast will reconcile if it actually deleted */
    }
  }

  return (
    <div className="group relative flex gap-2.5 rounded-lg px-2 py-1 hover:bg-white/[0.03]">
      {/* Hover action menu (top-right). */}
      <div className={`absolute -top-2 right-2 items-center gap-0.5 rounded-lg border border-white/10 bg-[#16181f] px-1 py-0.5 shadow-lg ${pickerOpen ? "flex" : "hidden group-hover:flex"}`}>
        <div className="relative">
          <ActBtn label="React" onClick={() => setPickerOpen((v) => !v)}><SmilePlus className="h-3.5 w-3.5" /></ActBtn>
          {pickerOpen && (
            <Popover onClose={() => setPickerOpen(false)} anchor="right" className="w-max">
              <EmojiPicker onPick={react} />
            </Popover>
          )}
        </div>
        <ActBtn label="Reply" onClick={onReply}><Reply className="h-3.5 w-3.5" /></ActBtn>
        <ActBtn label="Copy" onClick={() => navigator.clipboard?.writeText(m.content)}><Copy className="h-3.5 w-3.5" /></ActBtn>
        {mine && (
          <ActBtn label="Edit" onClick={() => { setEditText(m.content); setEditing(true); }}><Pencil className="h-3.5 w-3.5" /></ActBtn>
        )}
        {(mine || canModerate) && (
          <ActBtn label={mine ? "Delete" : "Delete (mod)"} onClick={doDelete} danger><Trash2 className="h-3.5 w-3.5" /></ActBtn>
        )}
      </div>

      <div className="relative">
        <button onClick={onOpenUser} className="shrink-0">
          {m.avatar_url ? (
            <img src={m.avatar_url} alt="" className="h-9 w-9 rounded-full" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/40 to-violet-600/40 text-sm font-bold text-white">
              {name.charAt(0).toUpperCase()}
            </div>
          )}
        </button>
        {open && (
          <Popover onClose={onClose} anchor="left" className="w-72">
            <UserCard userId={m.user_id} />
          </Popover>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {/* Reply preview line. */}
        {m.reply_content && (
          <div className="mb-0.5 flex items-center gap-1 truncate text-[11px] text-white/35">
            <Reply className="h-3 w-3 shrink-0 -scale-x-100" />
            <span className="text-white/50">{m.reply_author}</span>
            <span className="truncate">{m.reply_content}</span>
          </div>
        )}
        <div className="flex items-baseline gap-2">
          <button onClick={onOpenUser} className="text-xs font-semibold text-white hover:underline">
            {name}
          </button>
          <span className="text-[10px] text-white/30">{new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        {editing ? (
          <div className="mt-0.5 flex flex-col gap-1">
            <input
              value={editText}
              autoFocus
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit();
                if (e.key === "Escape") setEditing(false);
              }}
              className="w-full rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-sm text-white outline-none focus:border-white/25"
            />
            <span className="text-[10px] text-white/30">enter to save · esc to cancel</span>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-white/80">
            {m.content}
            {m.edited_at && <span className="ml-1 text-[10px] text-white/25">(edited)</span>}
          </p>
        )}
        {m.reactions && m.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {m.reactions.map((rx) => (
              <button
                key={rx.emoji}
                onClick={() => react(rx.emoji)}
                className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] transition-colors ${
                  rx.me
                    ? "border-indigo-400/40 bg-indigo-500/20 text-white"
                    : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                }`}
              >
                <span>{rx.emoji}</span>
                <span className="tabular-nums">{rx.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ActBtn({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      title={label}
      onClick={onClick}
      className={`rounded p-1 ${danger ? "text-red-400/80 hover:bg-red-500/15 hover:text-red-300" : "text-white/50 hover:bg-white/10 hover:text-white"}`}
    >
      {children}
    </button>
  );
}

// UserCard fetches and shows a member's public profile inside the popover. A
// moderator viewing another member gets a grant/revoke-moderator control.
function UserCard({ userId }: { userId: string }) {
  const profile = useProfile();
  const [p, setP] = useState<PublicProfile | null>(null);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    profileApi.publicById(userId).then(setP).catch(() => setErr(true));
  }, [userId]);

  if (err) return <div className="p-4 text-xs text-white/50">Couldn't load profile.</div>;
  if (!p) return <div className="flex h-24 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-white/30" /></div>;

  const canManage = profile.has("chat.moderate") && p.username !== profile.user?.username;
  async function toggleMod() {
    if (!p) return;
    setBusy(true);
    try {
      const r = await modApi.setModerator(p.id, !p.is_moderator);
      setP({ ...p, is_moderator: r.is_moderator });
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }

  return (
    <ProfileCard
      p={p}
      compact
      footer={
        <div className="space-y-1.5">
          <button onClick={() => openProfile(p.id)} className="w-full rounded-lg border border-white/15 px-2 py-1.5 text-xs text-white/80 hover:bg-white/5">
            View full profile
          </button>
          {canManage && (
            <button
              onClick={toggleMod}
              disabled={busy}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/15 px-2 py-1.5 text-xs font-medium text-white/80 hover:bg-white/5 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              {p.is_moderator ? "Revoke moderator" : "Make moderator"}
            </button>
          )}
        </div>
      }
    />
  );
}
