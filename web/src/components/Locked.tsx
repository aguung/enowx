import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip } from "./Tooltip";

// Locked is the lock UX for entitlement-gated features. It is UX ONLY — the
// server is the real gatekeeper (every perk endpoint re-checks). Use it to
// dim + disable a feature the user can't access yet, explaining why on hover.
export function Locked({
  locked,
  reason,
  children,
}: {
  locked: boolean;
  reason: string; // e.g. "Wear the [enow] server tag to unlock"
  children: ReactNode;
}) {
  if (!locked) return <>{children}</>;
  return (
    <Tooltip label={reason} maxWidth={220} block>
      <div className="relative w-full">
        <div className="pointer-events-none select-none opacity-40 blur-[1px]">{children}</div>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white/80 ring-1 ring-white/10">
            <Lock className="h-3 w-3" /> Locked
          </span>
        </div>
      </div>
    </Tooltip>
  );
}
