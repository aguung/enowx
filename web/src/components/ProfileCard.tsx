import { ShieldCheck, Coins, Link as LinkIcon, Crown, HandCoins, Star } from "lucide-react";

// cardRelTime formats an ISO timestamp as a short "2h ago".
function cardRelTime(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
import type { TopRole, ProfileLink, Equipped } from "../lib/api";

// CardProfile is the shape the card renders. Both SyncUser (self) and
// PublicProfile (others) satisfy it, so the card is reused in both places.
export interface CardProfile {
  username: string;
  avatar_url?: string;
  banner_url?: string; // image/gif banner (role-gated perk; grey when unset)
  display_name?: string;
  bio?: string;
  accent_color?: string;
  primary_color?: string;
  pronouns?: string;
  links?: ProfileLink[];
  plan?: string;
  top_role?: TopRole | null;
  wears_tag?: boolean;
  guild_tag?: string;
  kleos?: number;
  is_moderator?: boolean;
  is_premium?: boolean;
  is_donor?: boolean;
  online?: boolean;
  last_seen?: string;
  rating_avg?: number;
  rating_count?: number;
  equipped?: Equipped;
  created_at?: string;
}

// ProfileCard is the Discord-style profile card: grey banner, large avatar
// overlapping it, name + handle, badges row, and an About section (bio, links,
// member-since). Used as the Profile-app hero and (later) as a popover.
export function ProfileCard({ p, footer, compact }: { p: CardProfile; footer?: React.ReactNode; compact?: boolean }) {
  const initial = (p.display_name || p.username || "?").charAt(0).toUpperCase();
  // Like Discord: the card BODY is themed by a Primary→Accent gradient; the
  // banner is a separate element that defaults to grey (image/gif banner is a
  // future role-gated perk). When no theme is set, the body stays grey too.
  const hasTheme = !!(p.primary_color || p.accent_color);
  const primary = p.primary_color || p.accent_color || "#1a1c23";
  const accent = p.accent_color || p.primary_color || "#1a1c23";
  // Discord themes the body with a top-to-bottom Primary→Accent gradient. Even
  // 50:50 spread so neither color dominates.
  const body = hasTheme
    ? `linear-gradient(to bottom, ${primary} 0%, ${accent} 100%)`
    : "rgba(255,255,255,0.03)";
  // The avatar outline follows the primary color (falls back to dark when grey).
  const ring = p.primary_color || "#0b0c10";
  // Equipped cosmetics (bought with Kleos): banner preset gradient, title, badge,
  // and a visual effect class.
  const eq = p.equipped;
  const effectCls = eq?.effect === "glow" ? "shadow-[0_0_24px_-4px] shadow-indigo-500/40" : eq?.effect === "holo" ? "ring-1 ring-fuchsia-400/30" : "";

  return (
    <div className={`overflow-hidden rounded-2xl border border-white/10 ${effectCls}`}>
      {/* Banner — equipped preset gradient, else image/gif, else grey. Shorter
          in compact mode (e.g. a popover). */}
      <div
        className={`${compact ? "h-24" : "h-40"} w-full bg-white/[0.06]`}
        style={eq?.banner ? { background: eq.banner } : undefined}
      >
        {!eq?.banner && p.banner_url && <img src={p.banner_url} alt="" className="h-full w-full object-cover" />}
      </div>

      <div className="px-4 pb-4" style={{ background: body }}>
        {/* Only the avatar overlaps the banner (pulled up like Discord); the
            rest of the row (Kleos badge) stays in normal flow. */}
        <div className="mb-2 flex items-start justify-between pt-2">
          <div
            className="-ml-1 -mt-14 flex h-[72px] w-[72px] items-center justify-center rounded-full ring-[6px]"
            style={{ ["--tw-ring-color" as string]: ring }}
          >
            {p.avatar_url ? (
              <img src={p.avatar_url} alt="" className="h-full w-full rounded-full" />
            ) : (
              <div
                className="flex h-full w-full items-center justify-center rounded-full text-xl font-bold text-white"
                style={{ background: `linear-gradient(135deg, ${accent}, ${accent}99)` }}
              >
                {initial}
              </div>
            )}
          </div>
          {p.kleos !== undefined && (
            <span className="mb-1 flex items-center gap-1 rounded-full bg-amber-400/[0.08] px-2 py-0.5 text-[11px] font-semibold text-amber-200 ring-1 ring-inset ring-amber-400/15">
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-amber-500">
                <Coins className="h-2 w-2 text-amber-950" />
              </span>
              {p.kleos.toLocaleString()}
            </span>
          )}
        </div>

        {/* Equipped title (cosmetic). */}
        {eq?.title && (
          <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-300/80">{eq.title}</p>
        )}
        {/* Name + handle + pronouns. */}
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-base font-bold text-white">{p.display_name || p.username}</span>
          {p.display_name && <span className="truncate text-xs text-white/35">@{p.username}</span>}
        </div>
        {/* Presence + rating. */}
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="flex items-center gap-1 text-white/45">
            <span className={`h-1.5 w-1.5 rounded-full ${p.online ? "bg-emerald-400" : "bg-white/25"}`} />
            {p.online ? "Online" : p.last_seen ? `last seen ${cardRelTime(p.last_seen)}` : "Offline"}
          </span>
          {(p.rating_count ?? 0) > 0 && (
            <span className="flex items-center gap-0.5 text-amber-300"><Star className="h-3 w-3 fill-amber-300" />{(p.rating_avg ?? 0).toFixed(1)} <span className="text-white/35">({p.rating_count})</span></span>
          )}
        </div>
        {p.pronouns && <p className="text-[11px] text-white/40">{p.pronouns}</p>}

        {/* Badges. */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {p.top_role?.name ? <RoleBadge role={p.top_role} /> : p.plan && <PlanBadge plan={p.plan} />}
          {p.wears_tag && <TagBadge tag={p.guild_tag} />}
          {p.is_premium && <PremiumBadge />}
          {p.is_donor && <DonorBadge />}
          {p.is_moderator && <ModBadge />}
          {eq?.badge && (
            <span className="inline-flex items-center rounded-full bg-fuchsia-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fuchsia-200 ring-1 ring-inset ring-fuchsia-400/20">
              {eq.badge}
            </span>
          )}
        </div>

        {/* About: bio + links + member since. */}
        {(p.bio || (p.links && p.links.length > 0) || p.created_at) && (
          <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
            {p.bio && <p className="text-xs leading-relaxed text-white/70">{p.bio}</p>}
            {p.links && p.links.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {p.links.map((l, i) => (
                  <a
                    key={i}
                    href={l.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/70 hover:bg-white/10 hover:text-white"
                  >
                    <LinkIcon className="h-2.5 w-2.5" /> {l.label || l.url}
                  </a>
                ))}
              </div>
            )}
            {p.created_at && (
              <p className="text-[10px] uppercase tracking-wide text-white/30">
                Member since {new Date(p.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
              </p>
            )}
          </div>
        )}

        {footer && <div className="mt-3">{footer}</div>}
      </div>
    </div>
  );
}

// hex turns a Discord decimal color into #rrggbb.
function hex(n: number): string {
  return "#" + (n & 0xffffff).toString(16).padStart(6, "0");
}

function RoleBadge({ role }: { role: TopRole }) {
  const c1 = hex(role.primary || role.color);
  const c2 = role.secondary ? hex(role.secondary) : c1;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ring-white/10"
      style={{ background: `${c1}22` }}
    >
      {role.icon_url && <img src={role.icon_url} alt="" className="h-3.5 w-3.5" />}
      <span
        className="bg-clip-text text-transparent"
        style={{ backgroundImage: `linear-gradient(90deg, ${c1}, ${c2})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
      >
        {role.name}
      </span>
    </span>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  return (
    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
      {plan}
    </span>
  );
}

function ModBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-300 ring-1 ring-inset ring-sky-400/20">
      <ShieldCheck className="h-3 w-3" /> Mod
    </span>
  );
}

function PremiumBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300 ring-1 ring-inset ring-amber-400/30">
      <Crown className="h-3 w-3" /> Premium
    </span>
  );
}

function DonorBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-300 ring-1 ring-inset ring-rose-400/30">
      <HandCoins className="h-3 w-3" /> Donor
    </span>
  );
}

function TagBadge({ tag }: { tag?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-200 ring-1 ring-inset ring-indigo-400/20">
      <ShieldCheck className="h-3 w-3" /> {tag ? `[${tag}]` : "Tag"}
    </span>
  );
}
