import { useEffect, useState } from "react";
import { Loader2, Coins, Check, Lock, Gift, Mail, ExternalLink, Copy } from "lucide-react";
import { AppShell } from "./shell";
import { useProfile, refreshProfile } from "../os/useProfile";
import { shopApi, kleosApi, gmailStoreApi, type ShopState, type CosmeticItem, type Equipped, type GmailAccount } from "../lib/api";
import { copyText } from "../os/clipboard";
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
  const [dailyBusy, setDailyBusy] = useState(false);
  const [dailyDone, setDailyDone] = useState(false);
  const [dailyMsg, setDailyMsg] = useState("");

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

  async function claimDaily() {
    setDailyBusy(true); setDailyMsg(""); setError("");
    try {
      const r = await kleosApi.daily();
      setShop((s) => (s ? { ...s, kleos: r.balance } : s));
      refreshProfile();
      if (r.total_awarded > 0) {
        const parts = [`+${r.claimed_today} today`];
        if (r.reclaimed > 0) parts.push(`+${r.reclaimed} reclaimed (${r.date_reclaimed})`);
        setDailyMsg(`Daily Kleos: ${parts.join(" · ")}`);
      } else if (r.already_claimed) {
        setDailyMsg("Already claimed today — come back tomorrow.");
      }
      setDailyDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "claim failed");
    } finally {
      setDailyBusy(false);
    }
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
        <button
          onClick={claimDaily}
          disabled={dailyBusy || dailyDone}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium text-amber-100 hover:bg-amber-400/20 disabled:opacity-50"
          title="Claim your daily Kleos"
        >
          {dailyBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Gift className="h-3 w-3" />}
          {dailyDone ? "Claimed today" : "Claim daily"}
        </button>
      </div>
      {dailyMsg && <div className="mb-3 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2 text-xs text-emerald-200">{dailyMsg}</div>}

      {/* Official store: real products bought with money (IDR/Duitku). */}
      <GmailStoreCard />

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

// GmailStoreCard sells Gmail accounts from stock, paid with Duitku (IDR).
function GmailStoreCard() {
  const [info, setInfo] = useState<{ price_per_account: number; available: number } | null>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [ref, setRef] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [accounts, setAccounts] = useState<GmailAccount[] | null>(null);
  const [err, setErr] = useState("");

  const load = () => gmailStoreApi.info().then(setInfo).catch(() => setInfo(null));
  useEffect(() => { load(); }, []);

  // Poll a pending order until paid/delivered.
  useEffect(() => {
    if (!ref || accounts) return;
    const id = setInterval(async () => {
      try {
        const s = await gmailStoreApi.orderStatus(ref);
        setStatus(s.status);
        if (s.status === "delivered") {
          const a = await gmailStoreApi.accounts(ref);
          setAccounts(a.accounts ?? []);
          load();
        } else if (s.status === "failed" || s.status === "expired") {
          setErr("Payment wasn't completed.");
          setRef(null);
        }
      } catch { /* keep polling */ }
    }, 4000);
    return () => clearInterval(id);
  }, [ref, accounts]);

  const buy = async () => {
    setErr(""); setBusy(true);
    try {
      const r = await gmailStoreApi.buy(qty);
      setRef(r.order_ref); setStatus("pending");
      window.open(r.checkout_url, "_blank", "noreferrer");
    } catch (e) { setErr(e instanceof Error ? e.message : "failed to start order"); }
    finally { setBusy(false); }
  };

  if (!info || info.available === 0) return null; // hide when out of stock or unavailable

  return (
    <section className="mb-5">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">Official store</h2>
      <div className="rounded-xl border border-sky-400/20 bg-sky-400/[0.04] p-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-400/15"><Mail className="h-4.5 w-4.5 text-sky-300" /></span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">Gmail account</p>
            <p className="text-[11px] text-white/40">Rp{info.price_per_account.toLocaleString()} each · {info.available} in stock</p>
          </div>
        </div>

        {accounts ? (
          <div className="mt-3 space-y-1.5">
            <p className="text-[11px] font-medium text-emerald-300">Delivered — save these now:</p>
            {accounts.map((a) => (
              <div key={a.email} className="flex items-center gap-2 rounded-lg bg-black/30 px-2.5 py-1.5 text-[11px]">
                <code className="flex-1 truncate font-mono text-white/80">{a.email} : {a.password}</code>
                <button onClick={() => copyText(`${a.email}:${a.password}`)} className="shrink-0 rounded p-1 text-white/40 hover:bg-white/10 hover:text-white/80"><Copy className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        ) : ref ? (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-black/25 px-3 py-2 text-[11px] text-white/60">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for payment… ({status}). Complete it in the opened tab.
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            <input type="number" min={1} max={Math.min(info.available, 100)} value={qty}
              onChange={(e) => setQty(Math.max(1, Math.min(info.available, Number(e.target.value) || 1)))}
              className="w-16 rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-sm text-white/80 outline-none" />
            <button onClick={buy} disabled={busy}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-sky-400 px-3 py-1.5 text-xs font-semibold text-sky-950 hover:bg-sky-300 disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
              Buy for Rp{(info.price_per_account * qty).toLocaleString()}
            </button>
          </div>
        )}
        {err && <p className="mt-2 text-[11px] text-red-300">{err}</p>}
      </div>
    </section>
  );
}
