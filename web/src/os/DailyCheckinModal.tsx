import { useEffect, useRef, useState } from "react";
import { Gift, Sparkles, Loader2, X } from "lucide-react";
import { kleosApi } from "../lib/api";
import { useProfile } from "./useProfile";

// localStorage key for the last UTC date we showed/claimed the daily check-in,
// so the modal pops at most once per day per device even before a claim lands.
const SEEN_KEY = "daily-checkin-seen";

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

// DailyCheckinModal auto-pops once per UTC day (on login/boot) to claim the
// daily Kleos. It peeks the server for today's amount + whether it's already
// claimed; if unclaimed and not yet seen today, it shows the modal.
export function DailyCheckinModal() {
  const profile = useProfile();
  const [amount, setAmount] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState<{ total: number; balance: number } | null>(null);
  const checked = useRef(false);

  useEffect(() => {
    if (!profile.loggedIn || checked.current) return;
    checked.current = true;
    kleosApi
      .dailyStatus()
      .then((s) => {
        const seen = localStorage.getItem(SEEN_KEY);
        if (!s.already_claimed && seen !== todayUTC()) {
          setAmount(s.amount);
          setOpen(true);
        }
      })
      .catch(() => {});
  }, [profile.loggedIn]);

  const dismiss = () => {
    localStorage.setItem(SEEN_KEY, todayUTC());
    setOpen(false);
  };

  const claim = async () => {
    setClaiming(true);
    try {
      const r = await kleosApi.daily();
      localStorage.setItem(SEEN_KEY, todayUTC());
      setClaimed({ total: r.total_awarded, balance: r.balance });
    } catch {
      dismiss();
    } finally {
      setClaiming(false);
    }
  };

  if (!open || amount === null) return null;

  return (
    <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-amber-400/20 bg-gradient-to-b from-[#1a1710] to-[#12131a] p-6 text-center shadow-2xl">
        {!claimed && (
          <button onClick={dismiss} className="absolute right-3 top-3 rounded-md p-1 text-white/30 hover:bg-white/10 hover:text-white/70">
            <X className="h-4 w-4" />
          </button>
        )}

        {/* Glow */}
        <div className="pointer-events-none absolute inset-x-0 -top-16 mx-auto h-40 w-40 rounded-full bg-amber-400/20 blur-3xl" />

        <div className="relative">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-400/15 ring-1 ring-amber-400/30">
            {claimed ? <Sparkles className="h-8 w-8 text-amber-300" /> : <Gift className="h-8 w-8 text-amber-300" />}
          </div>

          {claimed ? (
            <>
              <h2 className="text-lg font-bold text-white">Nice — collected!</h2>
              <p className="mt-1 text-sm text-white/50">You earned</p>
              <p className="my-2 text-4xl font-black tracking-tight text-amber-300">+{claimed.total.toLocaleString()}</p>
              <p className="text-xs text-white/40">Kleos · balance {claimed.balance.toLocaleString()}</p>
              <button onClick={() => setOpen(false)} className="mt-5 w-full rounded-xl bg-white py-2.5 text-sm font-semibold text-black hover:opacity-90">
                Done
              </button>
            </>
          ) : (
            <>
              <h2 className="text-lg font-bold text-white">Daily check-in</h2>
              <p className="mt-1 text-sm text-white/50">Today's reward is</p>
              <p className="my-2 text-4xl font-black tracking-tight text-amber-300">{amount.toLocaleString()}</p>
              <p className="text-xs text-white/40">Kleos — the amount changes every day.</p>
              <button
                onClick={claim} disabled={claiming}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 py-2.5 text-sm font-semibold text-black hover:bg-amber-300 disabled:opacity-50"
              >
                {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
                {claiming ? "Collecting…" : `Collect ${amount.toLocaleString()} Kleos`}
              </button>
              <button onClick={dismiss} className="mt-2 w-full py-1.5 text-xs text-white/35 hover:text-white/60">Maybe later</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
