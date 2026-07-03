import type React from "react";
import type { NickTier, RoleBadge } from "../lib/api";

// The 4 identity tiers → nick colors. Free is plain white; the others are
// gradients (rendered via .role-name.role-gradient with --c1/--c2). Premium adds
// a persistent glow (.tier-glow).
const TIERS: Record<NickTier, { c1: string; c2: string; gradient: boolean; glow?: boolean }> = {
  free: { c1: "rgba(255,255,255,0.92)", c2: "rgba(255,255,255,0.92)", gradient: false },
  premium: { c1: "#ffe08a", c2: "#c8912b", gradient: true, glow: true }, // gold
  moderator: { c1: "#5ab0ff", c2: "#2156c9", gradient: true }, // blue (Poseidon-like)
  god: { c1: "#ff5a5a", c2: "#141414", gradient: true }, // red → black
};

// tierVars returns the CSS vars for a nick tier (for the .role-name element).
export function tierVars(tier?: NickTier | null): React.CSSProperties {
  const t = TIERS[tier ?? "free"] ?? TIERS.free;
  return { ["--c1" as string]: t.c1, ["--c2" as string]: t.c2 };
}

// tierClass returns the extra classes for a nick tier (gradient + glow).
export function tierClass(tier?: NickTier | null): string {
  const t = TIERS[tier ?? "free"] ?? TIERS.free;
  return `${t.gradient ? " role-gradient" : ""}${t.glow ? " tier-glow" : ""}`;
}

// TierBadge is the single identity chip for a user's tier. Free shows nothing
// (the plain white nick already says it); Premium/Moderator/GOD get a colored
// chip matching the nick gradient.
const TIER_BADGE: Partial<Record<NickTier, { label: string; c1: string; c2: string }>> = {
  premium: { label: "PREMIUM", c1: "#ffe08a", c2: "#c8912b" },
  moderator: { label: "MOD", c1: "#5ab0ff", c2: "#2156c9" },
  god: { label: "GOD", c1: "#ff5a5a", c2: "#141414" },
};
export function TierBadge({ tier }: { tier?: NickTier | null }) {
  const t = tier && TIER_BADGE[tier];
  if (!t) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ring-white/10"
      style={{ background: `${t.c1}22` }}
    >
      <span className="bg-clip-text text-transparent" style={{ backgroundImage: `linear-gradient(90deg, ${t.c1}, ${t.c2})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
        {t.label}
      </span>
    </span>
  );
}

// effectClass maps a cosmetic effect key (catalog payload) to the CSS classes
// that render it. Shared by the Shop preview and the profile card so they match.
export function effectClass(effect?: string | null): string {
  switch (effect) {
    case "glow": return "shadow-[0_0_24px_-4px] shadow-indigo-500/50";
    case "shimmer": return "fx-shimmer";
    case "gradient": return "fx-gradient";
    case "holo": return "ring-1 ring-fuchsia-400/40 fx-holo";
    case "neon": return "fx-neon";
    case "starfield": return "fx-starfield";
    case "rainbow": return "fx-rainbow";
    default: return "";
  }
}

// hexOf converts a decimal Discord color to a #rrggbb string (grey when 0).
function hexOf(n?: number): string {
  if (!n || n <= 0) return "#8a8f98";
  return "#" + n.toString(16).padStart(6, "0");
}

// RoleBadges renders a user's held Discord roles as small colored chips. `max`
// caps how many show (a "+k" chip covers the rest).
export function RoleBadges({ roles, max = 6, size = "sm" }: { roles?: RoleBadge[] | null; max?: number; size?: "sm" | "xs" }) {
  if (!roles || roles.length === 0) return null;
  const shown = roles.slice(0, max);
  const extra = roles.length - shown.length;
  const pad = size === "xs" ? "px-1 py-0 text-[9px]" : "px-1.5 py-0.5 text-[10px]";
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((r, i) => {
        const c1 = hexOf(r.primary || r.color);
        const c2 = r.secondary ? hexOf(r.secondary) : c1;
        return (
          <span key={i} className={`inline-flex items-center gap-1 rounded-full font-semibold ring-1 ring-inset ring-white/10 ${pad}`} style={{ background: `${c1}22` }}>
            {r.icon_url && <img src={r.icon_url} alt="" className="h-3 w-3" />}
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: `linear-gradient(90deg, ${c1}, ${c2})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{r.name}</span>
          </span>
        );
      })}
      {extra > 0 && <span className={`rounded-full bg-white/10 font-semibold text-white/50 ${pad}`}>+{extra}</span>}
    </span>
  );
}
