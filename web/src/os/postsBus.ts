import { useEffect, useState } from "react";
import { postsApi, type Post, type PostCategory, type Reaction } from "../lib/api";
import { subscribeLive } from "./liveBus";

// postsBus is the shared community-feed store. It loads a page, applies live
// post events (created/edited/deleted/upvote/reaction) from the shared live
// stream (liveBus), and exposes actions. Sort/category drive what's loaded.
let posts: Post[] = [];
let categories: PostCategory[] = [];
let sort = "hot";
let category = "";
let loading = false;
let loadingMore = false;
let hasMore = true;
let subscribed = false;
const PAGE = 25; // matches the server's postPageSize
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

// Live comment events, fanned out to open CommentThreads (which subscribe by
// postId). Reuses the single feed EventSource — no extra connection.
type CommentEvent = "comment_added" | "comment_deleted" | "comment_edited" | "comment_reaction_changed";
const commentListeners = new Set<(event: CommentEvent, data: any) => void>();

function emitComment(event: string, data: any) {
  commentListeners.forEach((l) => l(event as CommentEvent, data));
}

// subscribeComments registers a handler for live comment events and ensures the
// feed stream is open. Returns an unsubscribe function.
export function subscribeComments(handler: (event: CommentEvent, data: any) => void): () => void {
  commentListeners.add(handler);
  ensureStream();
  return () => {
    commentListeners.delete(handler);
  };
}

export async function loadFeed(opts?: { sort?: string; category?: string }) {
  if (opts?.sort !== undefined) sort = opts.sort;
  if (opts?.category !== undefined) category = opts.category;
  loading = true;
  hasMore = true;
  emit();
  try {
    const r = await postsApi.list({ sort, category });
    posts = r.posts ?? [];
    hasMore = (r.posts?.length ?? 0) >= PAGE;
    if (r.categories) categories = r.categories;
  } catch {
    /* keep old */
  } finally {
    loading = false;
    emit();
  }
}

// loadMore appends the next page (forward infinite scroll). Ranked sorts (hot)
// paginate by offset; recency sorts (new) by a `before` cursor on the last id.
export async function loadMoreFeed() {
  if (loadingMore || loading || !hasMore || posts.length === 0) return;
  loadingMore = true;
  emit();
  try {
    const ranked = sort !== "new";
    const r = await postsApi.list({
      sort,
      category,
      ...(ranked ? { offset: posts.length } : { before: posts[posts.length - 1].id }),
    });
    const next = r.posts ?? [];
    if (next.length === 0) {
      hasMore = false;
    } else {
      const seen = new Set(posts.map((p) => p.id));
      posts = [...posts, ...next.filter((p) => !seen.has(p.id))];
      hasMore = next.length >= PAGE;
    }
  } catch {
    /* ignore */
  } finally {
    loadingMore = false;
    emit();
  }
}

// ensureStream wires post + comment events from the shared live stream. Safe to
// call repeatedly; only subscribes once.
function ensureStream() {
  if (subscribed) return;
  subscribed = true;
  subscribeLive(
    [
      "post_created", "post_edited", "post_deleted", "post_upvote_changed", "post_reaction_changed",
      "comment_added", "comment_deleted", "comment_edited", "comment_reaction_changed",
    ],
    (event, data) => {
      switch (event) {
        case "post_created":
          if (!posts.some((p) => p.id === data.id) && (!category || data.category === category)) {
            posts = [data as Post, ...posts];
            emit();
          }
          break;
        case "post_edited":
          posts = posts.map((p) => (p.id === data.id ? { ...p, title: data.title, body: data.body } : p));
          emit();
          break;
        case "post_deleted":
          posts = posts.filter((p) => p.id !== data.id);
          emit();
          break;
        case "post_upvote_changed":
          posts = posts.map((p) => (p.id === data.id ? { ...p, upvotes: data.count } : p));
          emit();
          break;
        case "post_reaction_changed": {
          const incoming: Reaction[] = data.reactions ?? [];
          posts = posts.map((p) => {
            if (p.id !== data.id) return p;
            const mine = new Set((p.reactions ?? []).filter((r) => r.me).map((r) => r.emoji));
            return { ...p, reactions: incoming.map((r) => ({ ...r, me: mine.has(r.emoji) })) };
          });
          emit();
          break;
        }
        case "comment_added":
          posts = posts.map((p) => (p.id === data.post_id ? { ...p, comment_count: (p.comment_count ?? 0) + 1 } : p));
          emit();
          emitComment(event, data);
          break;
        case "comment_deleted":
          posts = posts.map((p) =>
            p.id === data.post_id ? { ...p, comment_count: Math.max(0, (p.comment_count ?? 0) - 1) } : p,
          );
          emit();
          emitComment(event, data);
          break;
        case "comment_edited":
        case "comment_reaction_changed":
          emitComment(event, data);
          break;
      }
    },
  );
}

// findPost returns an already-loaded post by id (for notification routing).
export function findPost(id: number): Post | undefined {
  return posts.find((p) => p.id === id);
}

export async function createPost(cat: string, title: string, body: string, images?: string[]) {
  const p = await postsApi.create(cat, title, body, images);
  if (p && !posts.some((x) => x.id === p.id)) {
    posts = [p, ...posts];
    emit();
  }
}

export async function upvotePost(id: number) {
  const r = await postsApi.upvote(id);
  posts = posts.map((p) => (p.id === id ? { ...p, upvotes: r.count, upvoted: r.me } : p));
  emit();
}

export async function reactPost(id: number, emoji: string) {
  const r = await postsApi.react(id, emoji);
  posts = posts.map((p) => (p.id === id ? { ...p, reactions: r.reactions } : p));
  emit();
}

export async function editPost(id: number, title: string, body: string) {
  await postsApi.edit(id, title, body);
  posts = posts.map((p) => (p.id === id ? { ...p, title, body, edited_at: new Date().toISOString() } : p));
  emit();
}

export async function deletePost(id: number) {
  await postsApi.remove(id);
  posts = posts.filter((p) => p.id !== id);
  emit();
}

export interface FeedState {
  posts: Post[];
  categories: PostCategory[];
  sort: string;
  category: string;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
}

export function useFeed(): FeedState {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    if (posts.length === 0) loadFeed();
    ensureStream();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return { posts, categories, sort, category, loading, loadingMore, hasMore };
}
