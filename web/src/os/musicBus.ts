import { useEffect, useState } from "react";
import { musicApi, type Track } from "../lib/api";

// Shared music player state. A single module-level <audio> element owns
// playback so it keeps playing when the user switches center views or opens
// other apps — React just reflects the store. State persists to localStorage so
// the player survives a reload (see AGENTS.md persistence + "shared data stays
// in sync across views").
//
// Playback model:
//   • context  — the list that is "playing" (Discover feed, a playlist, search
//     results). Playing a track from a list sets it as the context and plays
//     in order from there.
//   • queue    — an interrupt list ("play next"). When a track ends, the queue
//     is consumed first; once empty, playback continues through the context.
// So playing from Discover does NOT fill the queue: it advances the context,
// and a non-empty queue simply takes priority until drained.

const LS = "enx.music";

export type PlaySource = "queue" | "context";

export interface MusicState {
  current: Track | null; // the track actually loaded/playing
  source: PlaySource; // where `current` came from
  context: Track[]; // the running list (Discover / playlist / search)
  contextIndex: number; // position of the last-played context track (-1 none)
  queue: Track[]; // interrupt list, played before continuing the context
  playing: boolean;
  position: number; // seconds
  duration: number; // seconds
  volume: number; // 0..1
  loading: boolean;
  error: string;
}

interface Persisted {
  current: Track | null;
  source: PlaySource;
  context: Track[];
  contextIndex: number;
  queue: Track[];
  volume: number;
}

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(LS);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Persisted>;
      return {
        current: p.current ?? null,
        source: p.source === "queue" ? "queue" : "context",
        context: Array.isArray(p.context) ? p.context : [],
        contextIndex: typeof p.contextIndex === "number" ? p.contextIndex : -1,
        queue: Array.isArray(p.queue) ? p.queue : [],
        volume: typeof p.volume === "number" ? p.volume : 1,
      };
    }
  } catch {
    // ignore
  }
  return { current: null, source: "context", context: [], contextIndex: -1, queue: [], volume: 1 };
}

const persisted = loadPersisted();

let state: MusicState = {
  current: persisted.current,
  source: persisted.source,
  context: persisted.context,
  contextIndex: persisted.contextIndex,
  queue: persisted.queue,
  playing: false, // don't auto-resume audio on load
  position: 0,
  duration: 0,
  volume: persisted.volume,
  loading: false,
  error: "",
};

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function set(patch: Partial<MusicState>) {
  state = { ...state, ...patch };
  emit();
}
function savePersisted() {
  try {
    const p: Persisted = {
      current: state.current,
      source: state.source,
      context: state.context,
      contextIndex: state.contextIndex,
      queue: state.queue,
      volume: state.volume,
    };
    localStorage.setItem(LS, JSON.stringify(p));
  } catch {
    // ignore
  }
}

// The one audio element. Created lazily so SSR/build never touches it.
let audio: HTMLAudioElement | null = null;
function getAudio(): HTMLAudioElement {
  if (audio) return audio;
  const a = new Audio();
  a.preload = "auto";
  a.volume = state.volume;
  a.addEventListener("timeupdate", () => set({ position: a.currentTime }));
  a.addEventListener("durationchange", () => set({ duration: isFinite(a.duration) ? a.duration : 0 }));
  a.addEventListener("loadedmetadata", () => set({ duration: isFinite(a.duration) ? a.duration : 0 }));
  a.addEventListener("playing", () => {
    set({ playing: true, loading: false });
    recordCurrentPlay();
  });
  a.addEventListener("pause", () => set({ playing: false }));
  a.addEventListener("waiting", () => set({ loading: true }));
  a.addEventListener("canplay", () => set({ loading: false }));
  a.addEventListener("ended", () => next());
  a.addEventListener("error", () => set({ error: "playback failed", loading: false, playing: false }));
  audio = a;
  return a;
}

// Track the id we last recorded a play for, so resuming after a pause doesn't
// log the same track repeatedly — only a fresh load counts as a new play.
let recordedFor = "";

function recordCurrentPlay() {
  const track = state.current;
  if (!track || recordedFor === track.id) return;
  recordedFor = track.id;
  musicApi.recordPlay(track).catch(() => {
    /* history is best-effort */
  });
}

// load makes `track` the current track and starts playing. `patch` carries the
// source/context bookkeeping that goes with it.
function load(track: Track, patch: Partial<MusicState>, autoplay: boolean) {
  const a = getAudio();
  recordedFor = "";
  set({ current: track, error: "", position: 0, duration: 0, loading: true, ...patch });
  savePersisted();
  a.src = musicApi.streamUrl(track.id);
  a.load();
  if (autoplay) a.play().catch(() => set({ loading: false }));
}

// ---- public actions ----

// play a single track. If it belongs to the current context, continue the
// context from there; otherwise it becomes a one-item context.
export function play(track: Track) {
  const i = state.context.findIndex((t) => t.id === track.id);
  if (i >= 0) {
    load(track, { source: "context", contextIndex: i }, true);
  } else {
    load(track, { source: "context", context: [track], contextIndex: 0 }, true);
  }
}

// playInContext plays a track that is part of a list, setting that whole list
// as the running context (used by Discover / playlist / search "play").
export function playInContext(track: Track, context: Track[]) {
  const i = context.findIndex((t) => t.id === track.id);
  load(track, { source: "context", context, contextIndex: Math.max(0, i) }, true);
}

// playList starts a list as the context from a given position (e.g. "Play all").
export function playList(tracks: Track[], startAt = 0) {
  if (tracks.length === 0) return;
  const i = Math.min(Math.max(0, startAt), tracks.length - 1);
  load(tracks[i], { source: "context", context: tracks, contextIndex: i }, true);
}

// enqueue adds a track to the interrupt queue ("play next"). It does not change
// what is currently playing; if nothing is playing yet, it starts the queue.
export function enqueue(track: Track) {
  if (state.queue.some((t) => t.id === track.id)) return;
  const queue = [...state.queue, track];
  if (!state.current) {
    // nothing playing — pull it straight off the queue
    set({ queue });
    playNextFromQueue();
    return;
  }
  set({ queue });
  savePersisted();
}

export function removeFromQueue(id: string) {
  set({ queue: state.queue.filter((t) => t.id !== id) });
  savePersisted();
}

// playFromQueue jumps straight to a queued track now, dropping the items before
// it (they were going to play first, but the user picked this one).
export function playFromQueue(id: string) {
  const i = state.queue.findIndex((t) => t.id === id);
  if (i < 0) return;
  const track = state.queue[i];
  load(track, { source: "queue", queue: state.queue.slice(i + 1) }, true);
}

export function clearQueue() {
  set({ queue: [] });
  savePersisted();
}

// stop tears down playback entirely (used by "close player").
export function stop() {
  const a = getAudio();
  a.pause();
  a.removeAttribute("src");
  a.load();
  set({ current: null, source: "context", queue: [], context: [], contextIndex: -1, playing: false, position: 0, duration: 0 });
  savePersisted();
}

export function toggle() {
  const a = getAudio();
  if (!state.current) {
    next(); // nothing loaded — start whatever is up next
    return;
  }
  if (a.paused) a.play().catch(() => {});
  else a.pause();
}

function playNextFromQueue() {
  const [head, ...rest] = state.queue;
  if (!head) return false;
  load(head, { source: "queue", queue: rest }, true);
  return true;
}

// next advances playback: the queue takes priority, then the context continues.
export function next() {
  // 1) Anything in the queue plays first.
  if (state.queue.length > 0) {
    playNextFromQueue();
    return;
  }
  // 2) Otherwise continue the context from where we left off.
  const nextIdx = state.contextIndex + 1;
  if (nextIdx < state.context.length) {
    load(state.context[nextIdx], { source: "context", contextIndex: nextIdx }, true);
    return;
  }
  // 3) Nothing left.
  set({ playing: false });
}

export function prev() {
  const a = getAudio();
  // Restart the track if we're more than 3s in.
  if (a.currentTime > 3) {
    a.currentTime = 0;
    return;
  }
  // Step back within the context if possible; otherwise just restart.
  if (state.source === "context" && state.contextIndex > 0) {
    const i = state.contextIndex - 1;
    load(state.context[i], { source: "context", contextIndex: i }, true);
  } else {
    a.currentTime = 0;
  }
}

export function seek(seconds: number) {
  const a = getAudio();
  a.currentTime = seconds;
  set({ position: seconds });
}

export function setVolume(v: number) {
  const vol = Math.max(0, Math.min(1, v));
  getAudio().volume = vol;
  set({ volume: vol });
  savePersisted();
}

export function getState(): MusicState {
  return state;
}

export function useMusic(): MusicState {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return state;
}

export function currentTrack(): Track | null {
  return state.current;
}

export function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export { musicApi };
export type { Track };
