import { useState } from "react";
import { Sparkles, Loader2, Download, X } from "lucide-react";
import { Popover } from "../components/Popover";
import { Markdown } from "../components/Markdown";
import { useUpdate, applyUpdate } from "./updateBus";

// ChangelogButton sits in the top bar (left of the bell). It shows a red dot when
// a newer GitHub release exists, and opens a changelog popover with an update
// button.
export function ChangelogButton() {
  const { info, updating } = useUpdate();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");

  const doUpdate = async () => {
    setErr("");
    try {
      await applyUpdate();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "update failed");
    }
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} title="What's new" className="relative flex items-center rounded p-0.5 text-white/70 hover:text-white">
        <Sparkles className="h-3.5 w-3.5" />
        {info.update_available && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-[#0b0d12]" />}
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} anchor="right" valign="down" className="w-80">
          <div className="max-h-[70vh] overflow-hidden rounded-xl border border-white/10 bg-[#0e1016] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-white/40">What's new</span>
              <button onClick={() => setOpen(false)} className="rounded p-0.5 text-white/40 hover:bg-white/10 hover:text-white"><X className="h-3.5 w-3.5" /></button>
            </div>
            <div className="max-h-[60vh] space-y-2 overflow-auto p-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/60">{info.current || "…"}</span>
                {info.latest && info.update_available && (
                  <>
                    <span className="text-white/30">→</span>
                    <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">{info.latest}</span>
                  </>
                )}
              </div>

              {info.update_available ? (
                <>
                  <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-200">A new update is available.</div>
                  {info.notes && <div className="prose-invert text-xs text-white/70"><Markdown text={info.notes} /></div>}
                  {err && <div className="text-[11px] text-red-300">{err}</div>}
                  <button onClick={doUpdate} disabled={updating} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-400 disabled:opacity-60">
                    {updating ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating… will restart</> : <><Download className="h-3.5 w-3.5" /> Update now</>}
                  </button>
                </>
              ) : info.current === "dev" ? (
                <div className="text-[11px] text-white/40">You're on a development build.</div>
              ) : (
                <div className="text-[11px] text-emerald-300/80">You're on the latest version.</div>
              )}
            </div>
          </div>
        </Popover>
      )}
    </div>
  );
}
