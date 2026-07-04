import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";
import { subscribeOpenPanels, closeAllPanels } from "./usePanels";

// enowx is a desktop experience with a minimum usable size. When the viewport is
// too small (a phone/tablet, or a desktop window shrunk enough that the layout
// would get clipped), this gate covers the app with a black overlay asking the
// user to enlarge the window or switch to a larger screen.
//
// The required width grows with how many side panels are open: one panel fits at
// MIN_WIDTH, but two panels (left + right) would overlap the centre board on a
// smaller window, so we require MIN_WIDTH_2 then.
const MIN_WIDTH = 1024;
const MIN_WIDTH_2 = 1320; // two panels + docks + a usable centre board
const MIN_HEIGHT = 640;

function bigEnough(openPanels: number): boolean {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  if (coarse) return false; // touch device → not a desktop
  const needW = openPanels >= 2 ? MIN_WIDTH_2 : MIN_WIDTH;
  return window.innerWidth >= needW && window.innerHeight >= MIN_HEIGHT;
}

export function RequireDesktop({ children }: { children: React.ReactNode }) {
  const [openPanels, setOpenPanels] = useState(0);
  const [ok, setOk] = useState(() => bigEnough(0));

  useEffect(() => subscribeOpenPanels(setOpenPanels), []);

  useEffect(() => {
    const check = () => setOk(bigEnough(openPanels));
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [openPanels]);

  return (
    <>
      {children}
      {!ok && (
        <div className="fixed inset-0 z-[99999] flex flex-col items-center justify-center gap-6 bg-black px-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
            <Monitor className="h-7 w-7 text-white/70" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-lg font-semibold text-white">Window too small</h1>
            <p className="max-w-sm text-sm text-white/50">
              enowx needs a bigger window so the layout isn't clipped. Enlarge this window (or open it on a larger screen) to continue.
            </p>
          </div>
          {/* When two panels don't fit but the window is big enough for one,
              offer to close the panels instead of forcing a resize. */}
          {openPanels >= 2 && window.innerWidth >= MIN_WIDTH && (
            <button
              onClick={closeAllPanels}
              className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 hover:bg-white/10"
            >
              Close side panels
            </button>
          )}
        </div>
      )}
    </>
  );
}
