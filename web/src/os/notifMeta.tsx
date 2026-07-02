import { Bell, MessageSquare, ChevronUp, Smile, AtSign, Handshake, ShieldCheck, Truck, ShoppingCart, CircleDollarSign } from "lucide-react";
import type { Notification } from "../lib/api";
import { openProfile } from "./profileViewer";
import { openMarketplaceThread } from "./marketplaceNav";

// Shared icon/verb maps + click routing for notifications, used by both the
// top-bar bell and the macOS-style banner so they stay in sync.
export const NOTIF_ICON: Record<string, typeof Bell> = {
  reply: MessageSquare,
  upvote: ChevronUp,
  reaction: Smile,
  mention: AtSign,
  deal: Handshake,
  middleman: ShieldCheck,
  shipped: Truck,
  purchase: ShoppingCart,
  released: CircleDollarSign,
};

export const NOTIF_VERB: Record<string, string> = {
  reply: "replied",
  upvote: "upvoted",
  reaction: "reacted",
  mention: "mentioned you",
  deal: "wants to deal",
  middleman: "needs you as middleman",
  shipped: "shipped your item",
  purchase: "— your order is ready",
  released: "released the funds",
};

// Rekber/marketplace notifications carry the thread id in ref_id.
const REKBER_TYPES = new Set(["deal", "middleman", "shipped", "released"]);

// routeNotif opens the right context for a notification click.
export function routeNotif(n: Notification) {
  if (REKBER_TYPES.has(n.type) && n.ref_id) {
    openMarketplaceThread(n.ref_id);
    return;
  }
  if (n.actor_id) openProfile(n.actor_id);
}
