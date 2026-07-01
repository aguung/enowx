import { useEffect, useRef, useState } from "react";
import { Loader2, ChevronUp, Plus, SmilePlus, Pencil, Trash2, MessageSquare, Reply, Search, User, ImagePlus, X } from "lucide-react";
import { AppShell } from "./shell";
import { Popover } from "../components/Popover";
import { ProfileCard } from "../components/ProfileCard";
import { EmojiPicker } from "../components/EmojiPicker";
import { useProfile } from "../os/useProfile";
import { useDialog } from "../os/dialog";
import { useFeed, loadFeed, createPost, upvotePost, reactPost, editPost, deletePost } from "../os/postsBus";
import { openProfile } from "../os/profileViewer";
import { useImageAttach } from "../os/useImageAttach";
import { Markdown } from "../components/Markdown";
import { profileApi, commentsApi, searchApi, type Post, type PublicProfile, type Comment, type SearchPostHit, type SearchUserHit } from "../lib/api";

export function PostsApp() {
  const profile = useProfile();
  if (!profile.loggedIn) {
    return (
      <AppShell title="Posts" subtitle="Community feed">
        <div className="flex h-40 items-center justify-center text-sm text-white/55">Sign in to view and create posts.</div>
      </AppShell>
    );
  }
  return (
    <AppShell title="Posts" subtitle="Community feed">
      <Feed />
    </AppShell>
  );
}

function Feed() {
  const { posts, categories, sort, category, loading } = useFeed();
  const myUsername = useProfile().user?.username;
  const [composing, setComposing] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ posts: SearchPostHit[]; users: SearchUserHit[] } | null>(null);
  const [searching, setSearching] = useState(false);

  // Debounced search; clears to show the feed when the box is empty.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        setResults(await searchApi.query(term));
      } catch {
        /* ignore */
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3">
        <Search className="h-4 w-4 text-white/30" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search posts and people…"
          className="w-full bg-transparent py-2 text-sm text-white outline-none placeholder:text-white/30"
        />
        {searching && <Loader2 className="h-4 w-4 animate-spin text-white/30" />}
        {q && <button onClick={() => setQ("")} className="text-white/40 hover:text-white">✕</button>}
      </div>

      {results ? (
        <SearchResults results={results} searching={searching} />
      ) : (
      <>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-white/10 p-0.5">
          {["hot", "new"].map((s) => (
            <button
              key={s}
              onClick={() => loadFeed({ sort: s })}
              className={`rounded px-2.5 py-1 text-xs font-medium capitalize ${sort === s ? "bg-white/15 text-white" : "text-white/50 hover:text-white"}`}
            >
              {s}
            </button>
          ))}
        </div>
        <select
          value={category}
          onChange={(e) => loadFeed({ category: e.target.value })}
          className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-xs text-white outline-none"
        >
          <option value="">All</option>
          {categories.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
        <button
          onClick={() => setComposing(true)}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-indigo-500/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
        >
          <Plus className="h-3.5 w-3.5" /> New post
        </button>
      </div>

      {composing && <Composer categories={categories.map((c) => c)} onClose={() => setComposing(false)} />}

      {loading && posts.length === 0 ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-white/30" /></div>
      ) : posts.length === 0 ? (
        <div className="py-10 text-center text-sm text-white/40">No posts yet — be the first.</div>
      ) : (
        posts.map((p) => <PostCard key={p.id} p={p} myUsername={myUsername} />)
      )}
      </>
      )}
    </div>
  );
}

function SearchResults({ results, searching }: { results: { posts: SearchPostHit[]; users: SearchUserHit[] }; searching: boolean }) {
  const { posts, users } = results;
  if (searching && posts.length === 0 && users.length === 0) {
    return <div className="flex h-24 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-white/30" /></div>;
  }
  if (posts.length === 0 && users.length === 0) {
    return <p className="py-8 text-center text-sm text-white/40">No results.</p>;
  }
  return (
    <div className="space-y-5">
      {users.length > 0 && (
        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">People</h2>
          <div className="space-y-1.5">
            {users.map((u) => (
              <button key={u.id} onClick={() => openProfile(u.id)} className="flex w-full items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.02] p-2 text-left hover:bg-white/5">
                {u.avatar_url ? (
                  <img src={u.avatar_url} alt="" className="h-8 w-8 rounded-full" />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10"><User className="h-4 w-4 text-white/50" /></div>
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-white">{u.display_name || u.username}</div>
                  {u.display_name && <div className="truncate text-[11px] text-white/40">@{u.username}</div>}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
      {posts.length > 0 && (
        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">Posts</h2>
          <div className="space-y-1.5">
            {posts.map((p) => (
              <div key={p.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
                <div className="mb-0.5 flex items-center gap-2 text-[10px] text-white/40">
                  <span className="rounded-full bg-white/10 px-1.5 py-0.5 uppercase tracking-wide">{p.category}</span>
                  <span>by {p.username}</span>
                  <span className="flex items-center gap-0.5"><ChevronUp className="h-3 w-3" />{p.upvotes}</span>
                </div>
                <div className="text-sm font-semibold text-white">{p.title}</div>
                {p.body && <p className="mt-0.5 line-clamp-2 text-xs text-white/55">{p.body}</p>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Composer({ categories, onClose }: { categories: { key: string; label: string }[]; onClose: () => void }) {
  const [category, setCategory] = useState(categories[0]?.key ?? "general");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const img = useImageAttach();
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit() {
    if (!title.trim() || busy || img.uploading) return;
    setBusy(true);
    setError("");
    try {
      await createPost(category, title.trim(), body.trim(), img.imageUrl || undefined);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "couldn't post");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); img.upload(e.dataTransfer.files?.[0]); }}
    >
      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
      <div className="flex items-center gap-2">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-white outline-none">
          {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} placeholder="Title" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-sm text-white outline-none focus:border-white/25" />
      </div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} onPaste={img.onPaste} maxLength={4000} rows={3} placeholder="Write something… (optional)" className="w-full resize-none rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-sm text-white outline-none focus:border-white/25" />

      {(img.imageUrl || img.uploading) && (
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 p-2">
          {img.uploading ? (
            <div className="flex items-center gap-1.5 text-[11px] text-white/50"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…</div>
          ) : (
            <>
              <img src={img.imageUrl} alt="" className="h-12 w-12 rounded object-cover" />
              <button onClick={img.clear} className="ml-auto rounded p-0.5 text-white/40 hover:bg-white/10 hover:text-white"><X className="h-3.5 w-3.5" /></button>
            </>
          )}
        </div>
      )}
      {img.error && <p className="text-[11px] text-red-300">{img.error}</p>}

      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => img.upload(e.target.files?.[0])} />
      <div className="flex items-center gap-2">
        <button onClick={() => fileRef.current?.click()} disabled={img.uploading} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/60 hover:bg-white/5 disabled:opacity-50">
          <ImagePlus className="h-3.5 w-3.5" />
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={onClose} disabled={busy} className="rounded-lg px-3 py-1.5 text-xs text-white/50 hover:text-white disabled:opacity-50">Cancel</button>
          <button onClick={submit} disabled={busy || !title.trim() || img.uploading} className="flex items-center gap-1.5 rounded-lg bg-indigo-500/90 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Post
          </button>
        </div>
      </div>
    </div>
  );
}

function PostCard({ p, myUsername }: { p: Post; myUsername?: string }) {
  const dialog = useDialog();
  const profile = useProfile();
  const mine = !!myUsername && p.username === myUsername;
  const canMod = profile.has("chat.moderate");
  const [openUser, setOpenUser] = useState(false);
  const [picker, setPicker] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const name = p.display_name || p.username;

  async function doDelete() {
    const ok = await dialog.confirm({ title: "Delete post?", message: "This can't be undone.", confirmLabel: "Delete" });
    if (ok) await deletePost(p.id).catch(() => {});
  }
  async function doEdit() {
    const res = await dialog.form({
      title: "Edit post",
      fields: [
        { name: "title", label: "Title", defaultValue: p.title },
        { name: "body", label: "Body", defaultValue: p.body },
      ],
      confirmLabel: "Save",
    });
    if (res) await editPost(p.id, (res.title ?? "").trim() || p.title, (res.body ?? "").trim()).catch(() => {});
  }

  return (
    <div className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
      {/* Upvote column */}
      <button
        onClick={() => upvotePost(p.id)}
        className={`flex h-fit flex-col items-center gap-0.5 rounded-lg border px-2 py-1.5 ${p.upvoted ? "border-amber-400/40 bg-amber-400/15 text-amber-200" : "border-white/10 text-white/60 hover:bg-white/10"}`}
      >
        <ChevronUp className="h-4 w-4" />
        <span className="text-xs font-semibold tabular-nums">{p.upvotes}</span>
      </button>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2 text-[11px] text-white/40">
          <span className="rounded-full bg-white/10 px-1.5 py-0.5 uppercase tracking-wide text-white/60">{p.category}</span>
          <div className="relative">
            <button onClick={() => setOpenUser(true)} className="font-medium text-white/70 hover:underline">{name}</button>
            {openUser && (
              <Popover onClose={() => setOpenUser(false)} anchor="left" className="w-72">
                <UserCard userId={p.user_id} />
              </Popover>
            )}
          </div>
          <span>· {new Date(p.created_at).toLocaleDateString()}</span>
          {p.edited_at && <span>· edited</span>}
        </div>

        <h3 className="text-sm font-semibold text-white">{p.title}</h3>
        {p.body && <Markdown text={p.body} className="mt-1 break-words text-sm leading-relaxed text-white/75" />}
        {p.image_url && (
          <a href={p.image_url} target="_blank" rel="noreferrer" className="mt-2 block w-fit">
            <img src={p.image_url} alt="" className="max-h-96 max-w-full rounded-lg border border-white/10" />
          </a>
        )}

        {/* Reactions + actions */}
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {p.reactions?.map((rx) => (
            <button
              key={rx.emoji}
              onClick={() => reactPost(p.id, rx.emoji)}
              className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] ${rx.me ? "border-indigo-400/40 bg-indigo-500/20 text-white" : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"}`}
            >
              <span>{rx.emoji}</span><span className="tabular-nums">{rx.count}</span>
            </button>
          ))}
          <div className="relative">
            <button onClick={() => setPicker((v) => !v)} className="rounded-full border border-white/10 px-1.5 py-0.5 text-white/50 hover:bg-white/10">
              <SmilePlus className="h-3.5 w-3.5" />
            </button>
            {picker && (
              <Popover onClose={() => setPicker(false)} anchor="left" className="w-max">
                <EmojiPicker onPick={(e) => { setPicker(false); reactPost(p.id, e); }} />
              </Popover>
            )}
          </div>
          <button onClick={() => setShowComments((v) => !v)} className="ml-1 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] text-white/40 hover:bg-white/10 hover:text-white/70">
            <MessageSquare className="h-3 w-3" /> {p.comment_count ?? 0}
          </button>
          <div className="ml-auto flex items-center gap-1">
            {mine && <button onClick={doEdit} className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"><Pencil className="h-3.5 w-3.5" /></button>}
            {(mine || canMod) && <button onClick={doDelete} className="rounded p-1 text-red-400/70 hover:bg-red-500/15 hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /></button>}
          </div>
        </div>

        {showComments && <CommentThread postId={p.id} myUsername={myUsername} canMod={canMod} />}
      </div>
    </div>
  );
}

function CommentThread({ postId, myUsername, canMod }: { postId: number; myUsername?: string; canMod: boolean }) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);

  async function load() {
    try {
      const r = await commentsApi.list(postId);
      setComments(r.comments ?? []);
    } catch {
      setComments([]);
    }
  }
  useEffect(() => { load(); }, [postId]);

  async function send() {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      const c = await commentsApi.add(postId, draft.trim(), replyTo?.id);
      setComments((cs) => [...(cs ?? []), c]);
      setDraft("");
      setReplyTo(null);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: number) {
    await commentsApi.remove(id).catch(() => {});
    setComments((cs) => (cs ? cs.filter((c) => c.id !== id) : cs));
  }
  async function react(id: number, emoji: string) {
    const r = await commentsApi.react(id, emoji).catch(() => null);
    if (r) setComments((cs) => (cs ? cs.map((c) => (c.id === id ? { ...c, reactions: r.reactions } : c)) : cs));
  }

  // Group into top-level comments + their 1-level replies.
  const tops = (comments ?? []).filter((c) => !c.reply_to);
  const repliesByParent = new Map<number, Comment[]>();
  for (const c of comments ?? []) {
    if (c.reply_to) {
      const arr = repliesByParent.get(c.reply_to) ?? [];
      arr.push(c);
      repliesByParent.set(c.reply_to, arr);
    }
  }

  return (
    <div className="mt-3 space-y-2 border-t border-white/5 pt-3">
      {comments === null ? (
        <div className="flex justify-center py-2"><Loader2 className="h-4 w-4 animate-spin text-white/30" /></div>
      ) : tops.length === 0 ? (
        <p className="text-[11px] text-white/35">No comments yet.</p>
      ) : (
        tops.map((c) => (
          <div key={c.id}>
            <CommentItem c={c} mine={!!myUsername && c.username === myUsername} canMod={canMod} onReply={() => setReplyTo(c)} onRemove={() => remove(c.id)} onReact={(e) => react(c.id, e)} />
            {(repliesByParent.get(c.id) ?? []).map((rc) => (
              <div key={rc.id} className="ml-8 mt-2 border-l border-white/10 pl-2">
                <CommentItem c={rc} mine={!!myUsername && rc.username === myUsername} canMod={canMod} onReply={() => setReplyTo(c)} onRemove={() => remove(rc.id)} onReact={(e) => react(rc.id, e)} />
              </div>
            ))}
          </div>
        ))
      )}

      {replyTo && (
        <div className="flex items-center justify-between gap-2 rounded-t-lg bg-white/5 px-2 py-1 text-[11px] text-white/50">
          <span className="truncate">Replying to <span className="text-white/70">{replyTo.display_name || replyTo.username}</span></span>
          <button onClick={() => setReplyTo(null)} className="text-white/40 hover:text-white">✕</button>
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), send())}
          placeholder={replyTo ? `Reply to ${replyTo.display_name || replyTo.username}…` : "Add a comment…"}
          maxLength={2000}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs text-white outline-none focus:border-white/25"
        />
        <button onClick={send} disabled={busy || !draft.trim()} className="rounded-lg bg-indigo-500/90 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Send"}
        </button>
      </div>
    </div>
  );
}

function CommentItem({ c, mine, canMod, onReply, onRemove, onReact }: { c: Comment; mine: boolean; canMod: boolean; onReply: () => void; onRemove: () => void; onReact: (emoji: string) => void }) {
  return (
    <div className="group/c flex gap-2">
      {c.avatar_url ? (
        <img src={c.avatar_url} alt="" className="h-6 w-6 shrink-0 rounded-full" />
      ) : (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold text-white">{(c.display_name || c.username).charAt(0).toUpperCase()}</div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[11px] font-semibold text-white">{c.display_name || c.username}</span>
          <span className="text-[10px] text-white/30">{new Date(c.created_at).toLocaleDateString()}{c.edited_at ? " · edited" : ""}</span>
          <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover/c:opacity-100">
            <button onClick={onReply} className="rounded p-0.5 text-white/40 hover:bg-white/10 hover:text-white"><Reply className="h-3 w-3" /></button>
            <CommentReact onPick={onReact} />
            {(mine || canMod) && <button onClick={onRemove} className="rounded p-0.5 text-red-400/60 hover:bg-red-500/15 hover:text-red-300"><Trash2 className="h-3 w-3" /></button>}
          </div>
        </div>
        <Markdown text={c.body} className="break-words text-xs text-white/75" />
        {c.reactions && c.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {c.reactions.map((rx) => (
              <button key={rx.emoji} onClick={() => onReact(rx.emoji)} className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${rx.me ? "border-indigo-400/40 bg-indigo-500/20 text-white" : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"}`}>
                <span>{rx.emoji}</span><span className="tabular-nums">{rx.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CommentReact({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="rounded p-0.5 text-white/40 hover:bg-white/10 hover:text-white"><SmilePlus className="h-3 w-3" /></button>
      {open && (
        <Popover onClose={() => setOpen(false)} anchor="right" className="w-max">
          <EmojiPicker onPick={(e) => { setOpen(false); onPick(e); }} />
        </Popover>
      )}
    </div>
  );
}

function UserCard({ userId }: { userId: string }) {
  const [p, setP] = useState<PublicProfile | null>(null);
  useEffect(() => { profileApi.publicById(userId).then(setP).catch(() => {}); }, [userId]);
  if (!p) return <div className="flex h-24 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-white/30" /></div>;
  return (
    <ProfileCard
      p={p}
      compact
      footer={
        <button onClick={() => openProfile(userId)} className="w-full rounded-lg border border-white/15 px-2 py-1.5 text-xs text-white/80 hover:bg-white/5">
          View full profile
        </button>
      }
    />
  );
}
