import { useEffect, useState } from "react";
import { postsApi, type Post, type PostCategory, type Reaction } from "../lib/api";

// postsBus is the shared community-feed store. It loads a page, applies live
// post events (created/edited/deleted/upvote/reaction) from the same SSE stream
// chat uses, and exposes actions. Sort/category drive what's loaded.
let posts: Post[] = [];
let categories: PostCategory[] = [];
let sort = "hot";
let category = "";
let loading = false;
let es: EventSource | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export async function loadFeed(opts?: { sort?: string; category?: string }) {
  if (opts?.sort !== undefined) sort = opts.sort;
  if (opts?.category !== undefined) category = opts.category;
  loading = true;
  emit();
  try {
    const r = await postsApi.list({ sort, category });
    posts = r.posts ?? [];
    if (r.categories) categories = r.categories;
  } catch {
    /* keep old */
  } finally {
    loading = false;
    emit();
  }
}

function ensureStream() {
  if (es) return;
  es = new EventSource("/api/chat/stream");
  es.onmessage = (e) => {
    try {
      const ev = JSON.parse(e.data) as { event: string; data: any };
      switch (ev.event) {
        case "post_created":
          // Only prepend when it matches the current view; hot view will reorder
          // on next refresh anyway.
          if (!posts.some((p) => p.id === ev.data.id) && (!category || ev.data.category === category)) {
            posts = [ev.data as Post, ...posts];
            emit();
          }
          break;
        case "post_edited":
          posts = posts.map((p) => (p.id === ev.data.id ? { ...p, title: ev.data.title, body: ev.data.body } : p));
          emit();
          break;
        case "post_deleted":
          posts = posts.filter((p) => p.id !== ev.data.id);
          emit();
          break;
        case "post_upvote_changed":
          posts = posts.map((p) => (p.id === ev.data.id ? { ...p, upvotes: ev.data.count } : p));
          emit();
          break;
        case "post_reaction_changed": {
          const incoming: Reaction[] = ev.data.reactions ?? [];
          posts = posts.map((p) => {
            if (p.id !== ev.data.id) return p;
            const mine = new Set((p.reactions ?? []).filter((r) => r.me).map((r) => r.emoji));
            return { ...p, reactions: incoming.map((r) => ({ ...r, me: mine.has(r.emoji) })) };
          });
          emit();
          break;
        }
      }
    } catch {
      /* ignore */
    }
  };
}

export async function createPost(cat: string, title: string, body: string, imageUrl?: string) {
  const p = await postsApi.create(cat, title, body, imageUrl);
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
  return { posts, categories, sort, category, loading };
}
