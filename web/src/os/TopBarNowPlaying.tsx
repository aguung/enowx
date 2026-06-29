import { useState } from "react";
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, X, Music2, Loader2 } from "lucide-react";
import { Tooltip } from "../components/Tooltip";
import { Popover } from "../components/Popover";
import { useMusic, toggle, next, prev, seek, setVolume, currentTrack, stop, fmtTime } from "./musicBus";

// Now-playing readout that lives in the TopBar center. Compact controls inline;
// click the track to open a popover with the seek bar, prev, and volume. Renders
// nothing until a track is loaded.
export function TopBarNowPlaying() {
  const m = useMusic();
  const [open, setOpen] = useState(false);
  const track = currentTrack();
  if (!track) return null;

  const pct = m.duration > 0 ? (m.position / m.duration) * 100 : 0;

  return (
    <div className="pointer-events-none absolute left-1/2 top-0 z-[1] flex h-7 -translate-x-1/2 items-center">
      <div className="pointer-events-auto relative flex min-w-0 max-w-[360px] items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-white/5">
        <div className="relative h-4 w-4 shrink-0 overflow-hidden rounded-sm bg-white/10">
          {track.thumbnail ? (
            <img src={track.thumbnail} alt="" className="h-full w-full object-cover" />
          ) : (
            <Music2 className="absolute inset-0 m-auto h-2.5 w-2.5 text-white/40" />
          )}
        </div>

        {/* Click the title to open the full controls popover. */}
        <button
          onClick={() => setOpen((o) => !o)}
          className="min-w-0 truncate text-left text-[11px] text-white/70 hover:text-white"
          title="Now playing — click for controls"
        >
          <span className="font-medium text-white/85">{track.title}</span>
          {track.artist && <span className="text-white/45"> — {track.artist}</span>}
        </button>

        <div className="flex shrink-0 items-center">
          <Tooltip label={m.playing ? "Pause" : "Play"} place="bottom">
            <button onClick={toggle} className="rounded p-0.5 text-white/65 hover:bg-white/10 hover:text-white">
              {m.loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : m.playing ? (
                <Pause className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
            </button>
          </Tooltip>
          <Tooltip label="Next" place="bottom">
            <button onClick={next} className="rounded p-0.5 text-white/65 hover:bg-white/10 hover:text-white">
              <SkipForward className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>

        {open && <NowPlayingPopover pct={pct} onClose={() => setOpen(false)} />}
      </div>
    </div>
  );
}

function NowPlayingPopover({ pct, onClose }: { pct: number; onClose: () => void }) {
  const m = useMusic();
  const track = currentTrack();
  if (!track) return null;

  return (
    <Popover onClose={onClose} anchor="center" className="w-72 overflow-hidden rounded-2xl border border-white/10 bg-[#11131a]/98 shadow-2xl glass">
      <div className="flex items-center gap-2.5 border-b border-white/5 px-3 py-2.5">
        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded bg-white/10">
          {track.thumbnail ? (
            <img src={track.thumbnail} alt="" className="h-full w-full object-cover" />
          ) : (
            <Music2 className="absolute inset-0 m-auto h-4 w-4 text-white/40" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-white/90">{track.title}</div>
          <div className="truncate text-[11px] text-white/45">{track.artist || "—"}</div>
        </div>
        <button onClick={onClose} className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-3 py-3">
        {/* Seek bar */}
        <div
          className="group relative h-1.5 w-full cursor-pointer rounded-full bg-white/10"
          onClick={(e) => {
            if (m.duration <= 0) return;
            const r = e.currentTarget.getBoundingClientRect();
            seek(((e.clientX - r.left) / r.width) * m.duration);
          }}
        >
          <div className="h-full rounded-full bg-emerald-400/80" style={{ width: `${pct}%` }} />
          <div
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-300 opacity-0 transition-opacity group-hover:opacity-100"
            style={{ left: `${pct}%` }}
          />
        </div>
        <div className="mt-1 flex justify-between font-mono text-[10px] text-white/40">
          <span>{fmtTime(m.position)}</span>
          <span>{fmtTime(m.duration)}</span>
        </div>

        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Tooltip label="Previous" place="bottom">
              <button onClick={prev} className="rounded-md p-1.5 text-white/65 hover:bg-white/10 hover:text-white">
                <SkipBack className="h-4 w-4" />
              </button>
            </Tooltip>
            <Tooltip label={m.playing ? "Pause" : "Play"} place="bottom">
              <button onClick={toggle} className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
                {m.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : m.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
            </Tooltip>
            <Tooltip label="Next" place="bottom">
              <button onClick={next} className="rounded-md p-1.5 text-white/65 hover:bg-white/10 hover:text-white">
                <SkipForward className="h-4 w-4" />
              </button>
            </Tooltip>
          </div>

          <div className="flex items-center gap-1.5">
            <Tooltip label={m.volume === 0 ? "Unmute" : "Mute"} place="bottom">
              <button onClick={() => setVolume(m.volume === 0 ? 1 : 0)} className="rounded-md p-1 text-white/55 hover:bg-white/10 hover:text-white">
                {m.volume === 0 ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              </button>
            </Tooltip>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={m.volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="h-1 w-16 cursor-pointer accent-emerald-400"
              aria-label="Volume"
            />
          </div>
        </div>

        <button
          onClick={() => {
            stop();
            onClose();
          }}
          className="mt-2.5 w-full rounded-lg border border-white/10 py-1.5 text-[11px] text-white/45 hover:bg-white/5 hover:text-red-300"
        >
          Close player
        </button>
      </div>
    </Popover>
  );
}
