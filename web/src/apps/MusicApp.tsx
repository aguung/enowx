import { useEffect, useRef, useState } from "react";
import {
  Search,
  Play,
  Pause,
  Plus,
  Trash2,
  Loader2,
  Music2,
  Sparkles,
  ListMusic,
  RefreshCw,
  Share2,
  Download,
  ChevronLeft,
  FolderPlus,
  ListVideo,
  ListX,
} from "lucide-react";
import { AppShell, Empty } from "./shell";
import { Tooltip } from "../components/Tooltip";
import { Popover } from "../components/Popover";
import { useDialog } from "../os/dialog";
import { usePersisted } from "../os/usePersisted";
import { musicApi, type Track, type Playlist } from "../lib/api";
import { useMusic, playInContext, playList, playFromQueue, enqueue, toggle, currentTrack, removeFromQueue, clearQueue } from "../os/musicBus";
import { usedPlaylists } from "../os/musicPlaylists";
import { useDiscover } from "../os/musicDiscover";

type Tab = "discover" | "search" | "playlists" | "queue";

export function MusicApp() {
  const [tab, setTab] = usePersisted<Tab>("music-tab", "discover");
  const m = useMusic();

  const tabs: { id: Tab; label: string; icon: typeof Sparkles; badge?: number }[] = [
    { id: "discover", label: "Discover", icon: Sparkles },
    { id: "search", label: "Search", icon: Search },
    { id: "playlists", label: "Playlists", icon: ListMusic },
    { id: "queue", label: "Queue", icon: ListVideo, badge: m.queue.length },
  ];

  return (
    <AppShell title="Music" subtitle="Search, discover, and build playlists">
      <div className="mb-3 flex gap-1">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <Tooltip key={t.id} label={t.label} place="bottom">
              <button
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  tab === t.id ? "bg-white/12 text-white" : "text-white/50 hover:bg-white/5 hover:text-white/80"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                {t.badge ? (
                  <span className="rounded-full bg-white/15 px-1.5 text-[10px] font-semibold leading-tight text-white/70">{t.badge}</span>
                ) : null}
              </button>
            </Tooltip>
          );
        })}
      </div>

      {tab === "discover" && <Discover />}
      {tab === "search" && <SearchTab />}
      {tab === "playlists" && <Playlists />}
      {tab === "queue" && <Queue />}
    </AppShell>
  );
}

// ---- Discover (local "for you" feed) ----

function Discover() {
  const { tracks, loading, error, shuffle } = useDiscover();

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] text-white/40">Based on what you play — Shuffle for a fresh feed.</p>
        <Tooltip label="Shuffle a fresh feed" place="left">
          <button
            onClick={shuffle}
            disabled={loading}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-white/55 hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Shuffle
          </button>
        </Tooltip>
      </div>
      {error && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
      {tracks === null || (loading && tracks.length === 0) ? (
        <ListSkeleton />
      ) : tracks.length === 0 ? (
        <Empty message="Nothing to show yet. Play a few songs and your feed will fill in." />
      ) : (
        <TrackList tracks={tracks} onPlayAll={() => playList(tracks, 0)} />
      )}
    </div>
  );
}

// ---- Search ----

function SearchTab() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Track[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const reqId = useRef(0);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    const query = q.trim();
    if (!query) return;
    const id = ++reqId.current;
    setSearching(true);
    setError("");
    try {
      const r = await musicApi.search(query);
      if (id === reqId.current) setResults(r);
    } catch (err) {
      if (id === reqId.current) {
        setError(err instanceof Error ? err.message : "search failed");
        setResults([]);
      }
    } finally {
      if (id === reqId.current) setSearching(false);
    }
  }

  return (
    <div>
      <form onSubmit={search} className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search songs, artists…"
            className="h-9 w-full rounded-lg border border-white/10 bg-white/[0.03] pl-8 pr-3 text-xs text-white placeholder:text-white/30 focus:border-white/25 focus:outline-none"
          />
        </div>
        <Tooltip label="Search" place="bottom">
          <button
            type="submit"
            disabled={searching}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-xs font-medium text-white hover:bg-white/15 disabled:opacity-50"
          >
            {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Search
          </button>
        </Tooltip>
      </form>

      {error && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

      {results === null ? (
        <Empty message="Search for a song to get started." />
      ) : results.length === 0 ? (
        <Empty message="No results." />
      ) : (
        <TrackList tracks={results} onPlayAll={() => playList(results, 0)} />
      )}
    </div>
  );
}

// ---- Playlists ----

function Playlists() {
  const { playlists, create, remove, importPlaylist } = usedPlaylists();
  const [openId, setOpenId] = useState<number | null>(null);
  const dialog = useDialog();

  async function onCreate() {
    const name = await dialog.prompt({ title: "New playlist", placeholder: "Playlist name", confirmLabel: "Create" });
    if (name && name.trim()) await create(name.trim());
  }

  async function onImport() {
    const json = await dialog.prompt({
      title: "Import playlist",
      message: "Paste an exported playlist JSON.",
      placeholder: '{"version":1,"name":"…","tracks":[…]}',
      confirmLabel: "Import",
    });
    if (!json) return;
    try {
      const data = JSON.parse(json);
      await importPlaylist(data);
    } catch {
      await dialog.alert({ title: "Import failed", message: "That doesn't look like valid playlist JSON." });
    }
  }

  async function onDelete(p: Playlist) {
    const ok = await dialog.confirm({
      title: "Delete playlist?",
      message: `"${p.name}" and its ${p.count} track(s) will be removed.`,
      danger: true,
      confirmLabel: "Delete",
    });
    if (ok) await remove(p.id);
  }

  if (openId !== null) {
    return <PlaylistDetail id={openId} onBack={() => setOpenId(null)} />;
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-end gap-1">
        <Tooltip label="Import a playlist from JSON" place="bottom">
          <button onClick={onImport} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-white/55 hover:bg-white/10 hover:text-white">
            <Download className="h-3 w-3" /> Import
          </button>
        </Tooltip>
        <Tooltip label="Create a new playlist" place="bottom">
          <button onClick={onCreate} className="flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-[11px] font-medium text-white hover:bg-white/15">
            <FolderPlus className="h-3 w-3" /> New
          </button>
        </Tooltip>
      </div>

      {playlists === null ? (
        <ListSkeleton />
      ) : playlists.length === 0 ? (
        <Empty message="No playlists yet. Create one and add songs from Search or Discover." />
      ) : (
        <div className="space-y-1">
          {playlists.map((p) => (
            <div
              key={p.id}
              className="group flex items-center gap-2.5 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-2 hover:bg-white/[0.05]"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-gradient-to-br from-pink-500/30 to-rose-600/30">
                <ListMusic className="h-4 w-4 text-pink-200" />
              </div>
              <button onClick={() => setOpenId(p.id)} className="min-w-0 flex-1 text-left">
                <div className="truncate text-xs font-medium text-white/85">{p.name}</div>
                <div className="truncate text-[11px] text-white/40">{p.count} track{p.count === 1 ? "" : "s"}</div>
              </button>
              <Tooltip label="Delete playlist" place="left">
                <button onClick={() => onDelete(p)} className="rounded p-1 text-white/40 opacity-0 transition-opacity hover:bg-white/10 hover:text-red-300 group-hover:opacity-100">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlaylistDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { playlists, removeTrack } = usedPlaylists();
  const [pl, setPl] = useState<Playlist | null>(null);
  const [error, setError] = useState("");
  const dialog = useDialog();

  // Reload the detail whenever the shared playlist summary changes (e.g. a
  // track was added/removed somewhere) so the view stays in sync.
  const stamp = playlists?.find((p) => p.id === id)?.count;

  useEffect(() => {
    let alive = true;
    musicApi
      .playlist(id)
      .then((p) => alive && setPl(p))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "failed to load"));
    return () => {
      alive = false;
    };
  }, [id, stamp]);

  async function onShare() {
    try {
      const data = await musicApi.exportPlaylist(id);
      await navigator.clipboard.writeText(JSON.stringify(data));
      await dialog.alert({
        title: "Playlist exported",
        message: `The playlist JSON (share code ${data.share_code}) was copied to your clipboard. Import it on another enowx instance.`,
      });
    } catch {
      await dialog.alert({ title: "Export failed", message: "Could not export this playlist." });
    }
  }

  const tracks = pl?.tracks ?? [];

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <Tooltip label="Back to playlists" place="bottom">
          <button onClick={onBack} className="rounded-lg p-1 text-white/55 hover:bg-white/10 hover:text-white">
            <ChevronLeft className="h-4 w-4" />
          </button>
        </Tooltip>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white">{pl?.name ?? "…"}</div>
          <div className="text-[11px] text-white/40">{tracks.length} track{tracks.length === 1 ? "" : "s"}</div>
        </div>
        {tracks.length > 0 && (
          <Tooltip label="Play all" place="bottom">
            <button onClick={() => playList(tracks, 0)} className="flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-[11px] font-medium text-white hover:bg-white/15">
              <Play className="h-3 w-3" /> Play
            </button>
          </Tooltip>
        )}
        <Tooltip label="Export / share this playlist" place="bottom">
          <button onClick={onShare} className="rounded-lg p-1.5 text-white/55 hover:bg-white/10 hover:text-white">
            <Share2 className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>

      {error && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
      {pl === null ? (
        <ListSkeleton />
      ) : tracks.length === 0 ? (
        <Empty message="This playlist is empty. Add songs from Search or Discover." />
      ) : (
        <TrackList
          tracks={tracks}
          onPlayAll={() => playList(tracks, 0)}
          rowAction={(t) => (
            <Tooltip label="Remove from playlist" place="left">
              <button onClick={() => removeTrack(id, t.id)} className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-red-300">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          )}
        />
      )}
    </div>
  );
}

// ---- Queue (the current playback queue, from musicBus) ----

function Queue() {
  const m = useMusic();
  const current = currentTrack();

  if (m.queue.length === 0) {
    return <Empty message="Queue is empty. Play a song or use 'Play all' from Discover, Search, or a playlist." />;
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] text-white/40">{m.queue.length} track{m.queue.length === 1 ? "" : "s"} · plays next, before continuing</p>
        <Tooltip label="Clear the queue" place="left">
          <button onClick={clearQueue} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-white/55 hover:bg-white/10 hover:text-red-300">
            <ListX className="h-3 w-3" /> Clear
          </button>
        </Tooltip>
      </div>
      <div className="space-y-1">
        {m.queue.map((t) => {
          const isCurrent = current?.id === t.id;
          return (
            <Row
              key={t.id}
              track={t}
              active={isCurrent}
              playing={isCurrent && m.playing}
              onPlay={() => (isCurrent ? toggle() : playFromQueue(t.id))}
              action={
                <Tooltip label="Remove from queue" place="left">
                  <button onClick={() => removeFromQueue(t.id)} className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-red-300">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              }
            />
          );
        })}
      </div>
    </div>
  );
}

// ---- Shared track list + row ----

function TrackList({
  tracks,
  onPlayAll,
  rowAction,
}: {
  tracks: Track[];
  onPlayAll?: () => void;
  rowAction?: (t: Track) => React.ReactNode;
}) {
  const m = useMusic();
  const current = currentTrack();
  return (
    <div className="space-y-1">
      {onPlayAll && tracks.length > 1 && (
        <div className="mb-1 flex justify-end">
          <Tooltip label="Play this list in order" place="left">
            <button onClick={onPlayAll} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-white/55 hover:bg-white/10 hover:text-white">
              <Play className="h-3 w-3" /> Play all
            </button>
          </Tooltip>
        </div>
      )}
      {tracks.map((t) => {
        const isCurrent = current?.id === t.id;
        return (
          <Row
            key={t.id}
            track={t}
            active={isCurrent}
            playing={isCurrent && m.playing}
            // Playing a row plays the whole list as the running context, so
            // playback continues to the next list item (not into the queue).
            onPlay={() => (isCurrent ? toggle() : playInContext(t, tracks))}
            action={rowAction ? rowAction(t) : <AddToActions track={t} />}
          />
        );
      })}
    </div>
  );
}

// Per-row actions for search/discover rows: enqueue + add-to-playlist.
function AddToActions({ track }: { track: Track }) {
  const m = useMusic();
  const { playlists, create, addTrack } = usedPlaylists();
  const dialog = useDialog();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const inQueue = m.queue.some((x) => x.id === track.id);
  const list = playlists ?? [];

  async function addToExisting(p: Playlist) {
    setBusy(true);
    try {
      await addTrack(p.id, track);
    } finally {
      setBusy(false);
      setPicking(false);
    }
  }

  async function addToNew() {
    setPicking(false);
    const name = await dialog.prompt({ title: "New playlist", placeholder: "Playlist name", confirmLabel: "Create & add" });
    if (!name || !name.trim()) return;
    const { id } = await create(name.trim());
    await addTrack(id, track);
  }

  return (
    <div className="relative flex items-center">
      <Tooltip label="Add to playlist" place="left">
        <button onClick={() => setPicking((v) => !v)} className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white/80">
          <ListMusic className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
      <Tooltip label={inQueue ? "Already in queue" : "Add to queue"} place="left">
        <button onClick={() => enqueue(track)} disabled={inQueue} className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white/80 disabled:opacity-30">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </Tooltip>

      {picking && (
        <Popover onClose={() => setPicking(false)} anchor="right" className="w-52 overflow-hidden rounded-xl border border-white/10 bg-[#11131a]/98 shadow-2xl glass">
          <div className="border-b border-white/5 px-3 py-2 text-[11px] font-semibold text-white/60">Add to playlist</div>
          <div className="max-h-56 overflow-auto py-1">
            {list.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-white/40">No playlists yet.</div>
            ) : (
              list.map((p) => {
                const has = p.tracks?.some((x) => x.id === track.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => !has && addToExisting(p)}
                    disabled={busy || has}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs text-white/80 hover:bg-white/10 disabled:opacity-40"
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="shrink-0 text-[10px] text-white/35">{has ? "added" : `${p.count}`}</span>
                  </button>
                );
              })
            )}
          </div>
          <button
            onClick={addToNew}
            className="flex w-full items-center gap-1.5 border-t border-white/5 px-3 py-2 text-left text-xs font-medium text-emerald-300 hover:bg-white/5"
          >
            <FolderPlus className="h-3.5 w-3.5" /> New playlist…
          </button>
        </Popover>
      )}
    </div>
  );
}

function Row({
  track,
  active,
  playing,
  onPlay,
  action,
}: {
  track: Track;
  active: boolean;
  playing: boolean;
  onPlay: () => void;
  action: React.ReactNode;
}) {
  return (
    <div
      className={`group flex items-center gap-2.5 rounded-lg border px-2 py-1.5 ${
        active ? "border-emerald-500/30 bg-emerald-500/[0.06]" : "border-white/5 bg-white/[0.02] hover:bg-white/[0.05]"
      }`}
    >
      <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded bg-white/5">
        {track.thumbnail ? (
          <img src={track.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <Music2 className="absolute inset-0 m-auto h-4 w-4 text-white/30" />
        )}
        <button
          onClick={onPlay}
          className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100 data-[on=true]:opacity-100"
          data-on={active}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause className="h-4 w-4 text-white" /> : <Play className="h-4 w-4 text-white" />}
        </button>
      </div>
      <button onClick={onPlay} className="min-w-0 flex-1 text-left">
        <div className={`truncate text-xs font-medium ${active ? "text-emerald-200" : "text-white/85"}`}>{track.title}</div>
        <div className="truncate text-[11px] text-white/40">
          {track.artist}
          {track.album ? ` · ${track.album}` : ""}
        </div>
      </button>
      {track.duration && <span className="shrink-0 font-mono text-[10px] text-white/35">{track.duration}</span>}
      {action}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-1">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-white/5" />
      ))}
    </div>
  );
}
