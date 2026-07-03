import { useEffect, useState } from "react";
import { Loader2, Coins, Check, Lock } from "lucide-react";
import { AppShell } from "./shell";
import { useProfile, refreshProfile } from "../os/useProfile";
import { shopApi, type ShopState, type CosmeticItem, type Equipped } from "../lib/api";
import { effectClass } from "../os/tier";

// equippedPayload reads the equipped payload for a cosmetic kind.
function equippedPayload(eq: Equipped | undefined, kind: string): string {
  if (!eq) return "";
  return kind === "title" ? eq.title : kind === "badge" ? eq.badge : kind === "effect" ? eq.effect : kind === "banner" ? eq.banner : "";
}

const KIND_LABEL: Record<string, string> = { title: "Titles", badge: "Badges", effect: "Effects" };
const KIND_ORDER = ["title", "badge", "effect"];

// ShopApp lets the user spend Kleos on profile cosmetics, then equip what they
// own. Login-gated.
export function ShopApp() {
  const profile = useProfile();
  const [shop, setShop] = useState<ShopState | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      setShop(await shopApi.get());
    } catch (e) {
      setError(e instanceof Error ? e.message : "couldn't load the shop");
    }
  }
  useEffect(() => {
    if (profile.loggedIn) load();
  }, [profile.loggedIn]);

  if (!profile.loggedIn) {
    return (
      <AppShell title="Shop" subtitle="Spend Kleos on cosmetics">
        <div className="flex h-40 items-center justify-center text-sm text-white/55">Sign in to open the shop.</div>
      </AppShell>
    );
  }

  async function buy(item: CosmeticItem) {
    setError("");
    setBusy(item.id);
    try {
      const r = await shopApi.buy(item.id);
      setShop((s) => (s ? { ...s, kleos: r.kleos, owned: r.owned } : s));
      refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "purchase failed");
    } finally {
      setBusy("");
    }
  }

  async function equip(item: CosmeticItem, on: boolean) {
    setError("");
    setBusy(item.id);
    try {
      const r = await shopApi.equip(item.kind, on ? item.id : "");
      setShop((s) => (s ? { ...s, equipped: r.equipped } : s));
      refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "equip failed");
    } finally {
      setBusy("");
    }
  }

  return (
    <AppShell title="Shop" subtitle="Spend Kleos on cosmetics">
      {error && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

      <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-400/15 bg-amber-400/[0.04] px-3 py-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-amber-500">
          <Coins className="h-3 w-3 text-amber-950" />
        </span>
        <span className="text-sm font-semibold text-amber-100">{(shop?.kleos ?? 0).toLocaleString()}</span>
        <span className="text-[11px] text-white/40">your Kleos balance</span>
      </div>

      {!shop ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-white/30" /></div>
      ) : (
        KIND_ORDER.map((kind) => {
          const items = shop.catalog.filter((i) => i.kind === kind);
          if (items.length === 0) return null;
          return (
            <section key={kind} className="mb-5">
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">{KIND_LABEL[kind]}</h2>
              <div className="grid grid-cols-2 gap-2">
                {items.map((item) => {
                  const owned = shop.owned.includes(item.id);
                  const equipped = equippedPayload(shop.equipped, kind) === item.payload;
                  return (
                    <div key={item.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <Preview item={item} />
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-xs font-medium text-white">{item.name}</span>
                        {!owned && (
                          <span className="flex items-center gap-1 text-[11px] text-amber-200">
                            <Coins className="h-3 w-3" /> {item.price}
                          </span>
                        )}
                      </div>
                      <div className="mt-2">
                        {!owned ? (
                          <button
                            onClick={() => buy(item)}
                            disabled={!!busy || (shop.kleos ?? 0) < item.price}
                            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-white/10 px-2 py-1.5 text-xs font-medium text-white hover:bg-white/15 disabled:opacity-40"
                          >
                            {busy === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : (shop.kleos ?? 0) < item.price ? <Lock className="h-3.5 w-3.5" /> : null}
                            {(shop.kleos ?? 0) < item.price ? "Not enough" : "Buy"}
                          </button>
                        ) : (
                          <button
                            onClick={() => equip(item, !equipped)}
                            disabled={!!busy}
                            className={`flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium disabled:opacity-50 ${
                              equipped ? "bg-indigo-500/80 text-white hover:bg-indigo-500" : "border border-white/15 text-white/70 hover:bg-white/5"
                            }`}
                          >
                            {busy === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : equipped ? <Check className="h-3.5 w-3.5" /> : null}
                            {equipped ? "Equipped" : "Equip"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </AppShell>
  );
}

// Preview renders a small visual of the cosmetic.
function Preview({ item }: { item: CosmeticItem }) {
  if (item.kind === "title") {
    return <div className="flex h-10 items-center rounded-lg bg-black/20 px-2 text-[11px] font-medium uppercase tracking-wide text-indigo-300/80">{item.payload}</div>;
  }
  if (item.kind === "badge") {
    return (
      <div className="flex h-10 items-center rounded-lg bg-black/20 px-2">
        <span className="rounded-full bg-fuchsia-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fuchsia-200 ring-1 ring-inset ring-fuchsia-400/20">{item.payload}</span>
      </div>
    );
  }
  // effect — same rendering the profile card uses (shared effectClass)
  return (
    <div className={`flex h-10 items-center justify-center rounded-lg bg-black/20 text-[11px] text-white/70 ${effectClass(item.payload)}`}>
      {item.name}
    </div>
  );
}
