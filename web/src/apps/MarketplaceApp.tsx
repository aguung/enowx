import { useCallback, useEffect, useRef, useState } from "react";
import { Store, ShieldCheck, Plus, X, Search, RefreshCw, Loader2, Trash2, ImagePlus, ArrowLeft, Tag, Handshake, Send, Check, CircleDollarSign, ShoppingCart, ExternalLink, Copy, Wallet, AlertTriangle, Star, Boxes, Pencil } from "lucide-react";
import { marketplaceApi, rekberApi, orderApi, officialApi, payoutApi, reviewApi, type Listing, type ListingInput, type ListingCategory, type RekberThread, type RekberMessage, type Order, type OfficialProduct, type RekberOrder, type PayoutAccount } from "../lib/api";
import { useProfile } from "../os/useProfile";
import { SignInGate } from "../components/SignInGate";
import { useImageAttach } from "../os/useImageAttach";
import { useDialog } from "../os/dialog";
import { openLightbox } from "../os/lightbox";
import { openProfile } from "../os/profileViewer";
import { useMarketplaceNav, consumeMarketplaceThread } from "../os/marketplaceNav";
import { subscribeLive } from "../os/liveBus";

type Kind = "community" | "official";
type View = "browse" | "mine" | "deals" | "orders" | "payout";

function idr(amount: number, currency: string) {
  if (currency === "IDR") return "Rp " + amount.toLocaleString("id-ID");
  return currency + " " + amount.toLocaleString();
}

// relTime formats an ISO timestamp as a short "2h ago" / "just now".
function relTime(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// MktTab is one marketplace tab: icon + label, never wraps (the row scrolls).
function MktTab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium ${active ? "bg-white/12 text-white" : "text-white/50 hover:bg-white/5"}`}>
      {icon} {label}
    </button>
  );
}

export function MarketplaceApp() {
  const rootProfile = useProfile();
  const [view, setView] = useState<View>("browse");
  const [kind, setKind] = useState<Kind>("community");
  const [detail, setDetail] = useState<Listing | null>(null);
  const [creating, setCreating] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [openThread, setOpenThread] = useState<number | null>(null);
  const dialog = useDialog();

  const openDeal = (id: number) => { setOpenThread(id); setView("deals"); };

  // A rekber notification click routes here with a pending thread id.
  const mktNav = useMarketplaceNav();
  useEffect(() => {
    const id = consumeMarketplaceThread();
    if (id !== null) { setOpenThread(id); setView("deals"); }
  }, [mktNav]);

  // Live: refetch listings/deals when the catalog or an order changes anywhere.
  useEffect(() => {
    return subscribeLive(
      ["listing_created", "listing_updated", "listing_deleted", "order_updated", "order_delivered"],
      () => setRefreshKey((k) => k + 1),
    );
  }, []);

  // Selling requires a payout account first.
  const onSell = async () => {
    try {
      const r = await payoutApi.get();
      if (!r.set) {
        const ok = await dialog.confirm({ title: "Set your payout account first", message: "Before selling, set the account where rekber funds will be disbursed to you.", confirmLabel: "Set payout" });
        if (ok) setView("payout");
        return;
      }
    } catch { /* ignore */ }
    setCreating(true);
  };

  // Marketplace needs an account (cloud-backed). Gate before firing any request
  // so logged-out users see a clean sign-in card, not a "token revoked" error.
  if (!rootProfile.loading && !rootProfile.loggedIn) {
    return <SignInGate reason="Sign in to browse the marketplace" />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-white/5 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto no-scrollbar">
          <MktTab active={view === "browse" && kind === "official"} onClick={() => { setView("browse"); setKind("official"); }} icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Official" />
          <MktTab active={view === "browse" && kind === "community"} onClick={() => { setView("browse"); setKind("community"); }} icon={<Store className="h-3.5 w-3.5" />} label="Community" />
          <MktTab active={view === "mine"} onClick={() => setView("mine")} icon={<Boxes className="h-3.5 w-3.5" />} label="My Listings" />
          <MktTab active={view === "deals"} onClick={() => { setView("deals"); setOpenThread(null); }} icon={<Handshake className="h-3.5 w-3.5" />} label="Deals" />
          <MktTab active={view === "orders"} onClick={() => setView("orders")} icon={<ShoppingCart className="h-3.5 w-3.5" />} label="Orders" />
          <MktTab active={view === "payout"} onClick={() => setView("payout")} icon={<Wallet className="h-3.5 w-3.5" />} label="Payout" />
        </div>
        <button onClick={onSell} className="ml-1 flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black hover:opacity-90"><Plus className="h-3.5 w-3.5" /> Sell</button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {view === "payout" ? (
          <PayoutView />
        ) : view === "mine" ? (
          <MyListingsView refreshKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} />
        ) : view === "orders" ? (
          <OrdersView />
        ) : view === "deals" ? (
          <DealsView openThread={openThread} setOpenThread={setOpenThread} />
        ) : kind === "official" ? (
          <OfficialStore onBought={() => setView("orders")} />
        ) : (
          <Feed kind={kind} refreshKey={refreshKey} onOpen={setDetail} onDeal={openDeal} />
        )}
      </div>
      {/* Details is a modal popup, not a page. */}
      {detail && <ListingDetail listing={detail} onClose={() => setDetail(null)} onDeleted={() => setDetail(null)} onDeal={openDeal} />}
      {creating && <SellModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); setKind("community"); setView("browse"); setRefreshKey((k) => k + 1); }} />}
    </div>
  );
}

// PayoutView lets a seller set their disbursement account (bank/ewallet/qris).
function PayoutView() {
  const [kind, setKind] = useState<"bank" | "ewallet" | "qris">("bank");
  const [provider, setProvider] = useState("");
  const [number, setNumber] = useState("");
  const [holder, setHolder] = useState("");
  const [existingQris, setExistingQris] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const qris = useImageAttach();

  useEffect(() => {
    payoutApi.get().then((r) => {
      if (r.set && r.account) {
        setKind(r.account.kind);
        setProvider(r.account.provider); setNumber(r.account.number); setHolder(r.account.holder); setExistingQris(r.account.qris_url);
      }
    }).catch(() => {});
  }, []);

  const save = async () => {
    setErr(""); setMsg("");
    const body: Partial<PayoutAccount> = { kind };
    if (kind === "qris") {
      const q = qris.images[0] || existingQris;
      if (!q) { setErr("Upload your QRIS image."); return; }
      body.qris_url = q;
    } else {
      if (!provider.trim() || !number.trim() || !holder.trim()) { setErr("Fill in provider, number and holder name."); return; }
      body.provider = provider.trim(); body.number = number.trim(); body.holder = holder.trim();
    }
    setSaving(true);
    try { await payoutApi.set(body); if (body.qris_url) setExistingQris(body.qris_url); qris.clear(); setMsg("Payout account saved."); }
    catch (e) { setErr(e instanceof Error ? e.message : "failed"); }
    finally { setSaving(false); }
  };

  return (
    <div className="mx-auto max-w-lg p-4">
      <h2 className="text-sm font-semibold text-white">Payout account</h2>
      <p className="mt-1 text-xs text-white/50">This is where rekber funds are disbursed to you after a deal completes. You must set it before you can sell.</p>
      <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200/90">
        <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0" />
        Double-check your details. The admin is not responsible for funds sent to a wrong account.
      </div>

      <div className="mt-3 flex gap-1">
        {(["bank", "ewallet", "qris"] as const).map((k) => (
          <button key={k} onClick={() => setKind(k)} className={`rounded-lg px-2.5 py-1 text-xs ${kind === k ? "bg-white/12 text-white" : "text-white/45 hover:bg-white/5"}`}>{k === "bank" ? "Bank" : k === "ewallet" ? "E-wallet" : "QRIS"}</button>
        ))}
      </div>

      <div className="mt-3 space-y-2.5">
        {kind === "qris" ? (
          <div>
            <label className="mb-1 block text-[11px] text-white/50">QRIS image</label>
            <div className="flex items-center gap-2">
              {(qris.images[0] || existingQris) && <img src={qris.images[0] || existingQris} alt="" className="h-24 w-24 rounded object-cover" />}
              <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded border border-dashed border-white/15 text-white/40 hover:bg-white/5">
                {qris.uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                <span className="mt-0.5 text-[9px]">Upload</span>
                <input type="file" accept="image/*" className="hidden" onChange={(e) => qris.upload(e.target.files)} />
              </label>
            </div>
          </div>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-[11px] text-white/50">{kind === "bank" ? "Bank name" : "E-wallet"}</label>
              <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder={kind === "bank" ? "BCA / Mandiri / BNI…" : "DANA / OVO / GoPay…"} className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/25" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-white/50">Account number</label>
              <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="1234567890" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:border-white/25" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-white/50">Account holder name</label>
              <input value={holder} onChange={(e) => setHolder(e.target.value)} placeholder="Full name as on the account" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/25" />
            </div>
          </>
        )}
        {err && <div className="text-xs text-red-300">{err}</div>}
        {msg && <div className="flex items-center gap-1 text-xs text-emerald-300"><Check className="h-3.5 w-3.5" /> {msg}</div>}
        <button onClick={save} disabled={saving} className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:opacity-90 disabled:opacity-50">{saving ? "Saving…" : "Save payout account"}</button>
      </div>
    </div>
  );
}

function Feed({ kind, refreshKey, onOpen, onDeal }: { kind: Kind; refreshKey: number; onOpen: (l: Listing) => void; onDeal: (threadId: number) => void }) {
  const [items, setItems] = useState<Listing[] | null>(null);
  const [cats, setCats] = useState<ListingCategory[]>([]);
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [buyingId, setBuyingId] = useState<number | null>(null);
  const dialog = useDialog();

  // Buy = start a rekber deal directly from the card (no detail page first).
  const buy = async (l: Listing) => {
    const ok = await dialog.confirm({ title: `Buy "${l.title}"?`, message: "A private rekber chat with the seller and a middleman opens. The middleman holds your payment until you confirm the item is received.", confirmLabel: "Buy via rekber" });
    if (!ok) return;
    setBuyingId(l.id);
    try {
      const t = await rekberApi.create(l.id);
      onDeal(t.id);
    } catch (e) {
      await dialog.alert({ title: "Couldn't start the deal", message: e instanceof Error ? e.message : "failed" });
    } finally {
      setBuyingId(null);
    }
  };

  const load = useCallback(async () => {
    try {
      const r = await marketplaceApi.list({ kind, category, q });
      setItems(r?.listings ?? []);
      if (r?.categories) setCats(r.categories);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to load");
      setItems([]);
    }
  }, [kind, category, q]);
  useEffect(() => { setItems(null); load(); }, [load, refreshKey]);

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-white/40" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search listings…" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none" />
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-white/80 outline-none">
          <option value="">All categories</option>
          {cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <button onClick={load} className="rounded-lg border border-white/10 p-1.5 text-white/50 hover:bg-white/5 hover:text-white"><RefreshCw className="h-3.5 w-3.5" /></button>
      </div>
      {err && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{err}</div>}
      {!items ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-white/40" /></div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-xs text-white/40">
          {kind === "official" ? "No official products yet." : "No listings yet. Be the first to sell something."}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {/* Prioritize listings whose seller is online (stable within each group). */}
          {[...items].sort((a, b) => Number(!!b.seller_online) - Number(!!a.seller_online)).map((l) => (
            <ListingCard key={l.id} l={l} onOpen={() => onOpen(l)} onBuy={() => buy(l)} buying={buyingId === l.id} />
          ))}
        </div>
      )}
    </div>
  );
}

function ListingCard({ l, onOpen, onBuy, buying }: { l: Listing; onOpen: () => void; onBuy: () => void; buying: boolean }) {
  const myUsername = useProfile().user?.username;
  const mine = !!myUsername && l.username === myUsername;
  return (
    <div className="group overflow-hidden rounded-xl border border-white/10 bg-white/[0.02] hover:border-white/20">
      <button onClick={onOpen} className="block w-full text-left">
        <div className="aspect-video w-full overflow-hidden bg-white/5">
          {l.images[0] ? (
            <img src={l.images[0]} alt="" className="h-full w-full object-cover transition group-hover:scale-105" />
          ) : (
            <div className="flex h-full items-center justify-center text-white/20"><Tag className="h-6 w-6" /></div>
          )}
        </div>
        <div className="p-2.5 pb-1.5">
          <div className="truncate text-xs font-medium text-white">{l.title}</div>
          <div className="mt-0.5 text-sm font-semibold text-emerald-300">{idr(l.price_amount, l.currency)}</div>
          <div className="mt-1 truncate text-[10px] text-white/35">by {l.display_name || l.username}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[10px]">
            {l.seller_online ? (
              <span className="flex items-center gap-1 text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Online</span>
            ) : (
              <span className="text-white/35">{l.seller_last_seen ? `last seen ${relTime(l.seller_last_seen)}` : "offline"}</span>
            )}
            {(l.seller_rating_count ?? 0) > 0 && (
              <span className="ml-auto flex shrink-0 items-center gap-0.5 text-amber-300"><Star className="h-2.5 w-2.5 fill-amber-300" />{(l.seller_rating_avg ?? 0).toFixed(1)}</span>
            )}
          </div>
        </div>
      </button>
      <div className="flex gap-1.5 p-2.5 pt-1">
        <button onClick={onOpen} className="flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[11px] font-medium text-white/70 hover:bg-white/10">Details</button>
        {mine ? (
          <span className="flex-1 rounded-lg bg-white/[0.03] px-2 py-1.5 text-center text-[11px] text-white/30">Yours</span>
        ) : (
          <button onClick={onBuy} disabled={buying} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-indigo-500 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-400 disabled:opacity-50">
            {buying ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShoppingCart className="h-3 w-3" />} Buy
          </button>
        )}
      </div>
    </div>
  );
}

function ListingDetail({ listing, onClose, onDeleted, onDeal }: { listing: Listing; onClose: () => void; onDeleted: () => void; onDeal: (threadId: number) => void }) {
  const profile = useProfile();
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  const [dealing, setDealing] = useState(false);
  const mine = !!profile.user?.username && listing.username === profile.user.username;
  const canMod = profile.has("chat.moderate");

  const startDeal = async () => {
    const ok = await dialog.confirm({ title: "Start a rekber deal?", message: `A private chat with the seller and a middleman will open. The middleman holds your payment until you confirm the item is received.`, confirmLabel: "Start deal" });
    if (!ok) return;
    setDealing(true);
    try {
      const t = await rekberApi.create(listing.id);
      onClose();
      onDeal(t.id);
    } catch (e) {
      await dialog.alert({ title: "Couldn't start deal", message: e instanceof Error ? e.message : "failed" });
    } finally {
      setDealing(false);
    }
  };

  const remove = async () => {
    const ok = await dialog.confirm({ title: "Delete listing?", message: `"${listing.title}" will be removed.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    setBusy(true);
    try { await marketplaceApi.remove(listing.id); onDeleted(); onClose(); } catch { /* ignore */ } finally { setBusy(false); }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-start justify-center overflow-auto bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="my-auto w-full max-w-2xl rounded-2xl border border-white/10 bg-[#11131a] p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex justify-end">
          <button onClick={onClose} className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        {listing.images.length > 0 && (
          <div className="mb-3 grid grid-cols-2 gap-2">
            {listing.images.map((src, i) => (
              <img key={i} src={src} alt="" onClick={() => openLightbox(listing.images, i)} className={`cursor-zoom-in rounded-lg object-cover ${listing.images.length === 1 ? "col-span-2 max-h-80 w-full" : "aspect-video w-full"}`} />
            ))}
          </div>
        )}
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {listing.kind === "official" && <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-sky-300">Official</span>}
              <h1 className="text-lg font-semibold text-white">{listing.title}</h1>
            </div>
            <div className="mt-1 text-xl font-bold text-emerald-300">{idr(listing.price_amount, listing.currency)}</div>
          </div>
          {(mine || canMod) && (
            <button onClick={remove} disabled={busy} className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-white/55 hover:bg-red-500/30 hover:text-red-200 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
          <button onClick={() => openProfile(listing.user_id)} className="flex items-center gap-1.5 text-white/60 hover:underline">
            <span className={`h-1.5 w-1.5 rounded-full ${listing.seller_online ? "bg-emerald-400" : "bg-white/25"}`} />
            Seller: {listing.display_name || listing.username}
          </button>
          <span className="text-white/35">
            {listing.seller_online ? "online" : listing.seller_last_seen ? `last seen ${relTime(listing.seller_last_seen)}` : "offline"}
          </span>
          {(listing.seller_rating_count ?? 0) > 0 && (
            <span className="flex items-center gap-0.5 text-amber-300"><Star className="h-3 w-3 fill-amber-300" />{(listing.seller_rating_avg ?? 0).toFixed(1)} <span className="text-white/35">({listing.seller_rating_count})</span></span>
          )}
        </div>
        {listing.warranty && <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2 text-[11px] text-emerald-200/90">Warranty: {listing.warranty}</div>}
        {listing.description && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-white/70">{listing.description}</p>}
        <div className="mt-4 flex gap-2">
          {mine ? (
            <button disabled className="flex-1 cursor-not-allowed rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white/40">This is your listing</button>
          ) : (
            <button onClick={startDeal} disabled={dealing} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50">
              {dealing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Handshake className="h-4 w-4" />} Deal via rekber
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// MyListingsView lists the seller's own listings with stock + an edit action.
function MyListingsView({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [items, setItems] = useState<Listing[] | null>(null);
  const [editing, setEditing] = useState<Listing | null>(null);
  const dialog = useDialog();

  const load = useCallback(() => {
    marketplaceApi.mine().then((r) => setItems(r?.listings ?? [])).catch(() => setItems([]));
  }, []);
  useEffect(() => { setItems(null); load(); }, [load, refreshKey]);

  const remove = async (l: Listing) => {
    const ok = await dialog.confirm({ title: `Delete "${l.title}"?`, message: "This removes your listing from the marketplace.", confirmLabel: "Delete" });
    if (!ok) return;
    await marketplaceApi.remove(l.id).catch(() => {});
    onChanged();
  };

  return (
    <div className="p-4">
      {!items ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-white/40" /></div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-xs text-white/40">You have no listings yet. Hit “Sell” to post one.</div>
      ) : (
        <div className="space-y-2">
          {items.map((l) => (
            <div key={l.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
              {l.images?.[0] ? <img src={l.images[0]} alt="" className="h-12 w-12 rounded-lg object-cover" /> : <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/5 text-white/30"><Tag className="h-4 w-4" /></div>}
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-white">{l.title}</div>
                <div className="text-[11px] text-emerald-300">{idr(l.price_amount, l.currency)}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-white/40">
                  <span className={`rounded px-1 ${l.stock > 0 ? "bg-white/10 text-white/60" : "bg-rose-500/15 text-rose-300"}`}>{l.stock > 0 ? `${l.stock} in stock` : "out of stock"}</span>
                  {l.status && l.status !== "active" && <span className="rounded bg-white/10 px-1 uppercase">{l.status}</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => setEditing(l)} title="Edit" className="rounded-lg border border-white/10 p-1.5 text-white/50 hover:bg-white/10 hover:text-white"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => remove(l)} title="Delete" className="rounded-lg border border-white/10 p-1.5 text-white/40 hover:bg-red-500/20 hover:text-red-200"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <SellModal listing={editing} onClose={() => setEditing(null)} onCreated={() => { setEditing(null); onChanged(); }} />}
    </div>
  );
}

function SellModal({ listing, onClose, onCreated }: { listing?: Listing; onClose: () => void; onCreated: () => void }) {
  const editing = !!listing;
  const [title, setTitle] = useState(listing?.title ?? "");
  const [category, setCategory] = useState(listing?.category ?? "other");
  const [price, setPrice] = useState(listing ? String(listing.price_amount) : "");
  const [description, setDescription] = useState(listing?.description ?? "");
  const [warranty, setWarranty] = useState(listing?.warranty ?? "");
  const [stock, setStock] = useState(listing ? String(listing.stock) : "");
  const [cats, setCats] = useState<ListingCategory[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const img = useImageAttach(listing?.images ?? []);

  useEffect(() => { marketplaceApi.list({ kind: "community" }).then((r) => setCats(r?.categories ?? [])).catch(() => {}); }, []);

  const submit = async () => {
    if (!title.trim()) { setErr("Title required"); return; }
    setSaving(true); setErr("");
    const body: ListingInput = {
      kind: "community", category, title: title.trim(), description: description.trim(),
      images: img.images, price_amount: Math.max(0, parseInt(price || "0", 10) || 0),
      currency: "IDR", stock: Math.max(0, parseInt(stock || "0", 10) || 0), warranty: warranty.trim(),
    };
    try {
      if (editing) await marketplaceApi.update(listing!.id, body);
      else await marketplaceApi.create(body);
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : editing ? "failed to save" : "failed to create");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[90%] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#11131a] shadow-2xl" onClick={(e) => e.stopPropagation()} onPaste={img.onPaste}>
        <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
          <div className="flex-1 text-sm font-semibold text-white">{editing ? "Edit listing" : "New listing"}</div>
          <button onClick={onClose} className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/25" />
          <div className="flex gap-2">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="flex-1 rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-sm text-white/80 outline-none">
              {cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <div className="flex items-center rounded-lg border border-white/10 bg-black/30 px-2">
              <span className="text-xs text-white/40">Rp</span>
              <input value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} placeholder="0" inputMode="numeric" className="w-24 bg-transparent px-2 py-2 text-sm text-white outline-none" />
            </div>
          </div>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" rows={4} className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/25" />
          <div className="flex gap-2">
            <input value={warranty} onChange={(e) => setWarranty(e.target.value)} placeholder="Warranty (optional)" className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/25" />
            <input value={stock} onChange={(e) => setStock(e.target.value.replace(/\D/g, ""))} placeholder="Stock" inputMode="numeric" className="w-20 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/25" />
          </div>
          {img.images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {img.images.map((src, i) => (
                <div key={i} className="relative">
                  <img src={src} alt="" className="h-16 w-16 rounded-lg object-cover" />
                  <button onClick={() => img.removeAt(i)} className="absolute -right-1 -top-1 rounded-full bg-black/80 p-0.5 text-white/70 hover:text-white"><X className="h-3 w-3" /></button>
                </div>
              ))}
            </div>
          )}
          <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/60 hover:bg-white/10">
            <ImagePlus className="h-3.5 w-3.5" /> {img.uploading ? "Uploading…" : `Add images (${img.images.length}/${img.max})`}
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => img.upload(e.target.files)} />
          </label>
          {err && <div className="text-xs text-red-300">{err}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-white/5 px-4 py-3">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-white/50 hover:text-white">Cancel</button>
          <button onClick={submit} disabled={saving} className="flex items-center gap-1.5 rounded-lg bg-white px-4 py-1.5 text-xs font-medium text-black hover:opacity-90 disabled:opacity-50">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {editing ? "Save changes" : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}

const STATUS_STEPS = ["open", "awaiting_payment", "payment_sent", "funds_held", "shipped", "released"] as const;
const STATUS_LABEL: Record<string, string> = {
  open: "Opened", awaiting_payment: "Awaiting payment", payment_sent: "Paid", funds_held: "Funds held", shipped: "Shipped", released: "Completed",
  cancelled: "Cancelled",
};
// action key → button label + icon.
const ACTION_META: Record<string, { label: string; icon: typeof Check }> = {
  "send-payment-info": { label: "Send payment info", icon: CircleDollarSign },
  "mark-paid": { label: "Mark as paid", icon: Check },
  "confirm-funds": { label: "Confirm funds received", icon: Check },
  "mark-shipped": { label: "Mark as shipped", icon: Send },
  "confirm-receipt": { label: "Confirm received", icon: Check },
  "release": { label: "Release funds to seller", icon: CircleDollarSign },
};

function idrShort(n: number, c: string) { return c === "IDR" ? "Rp " + n.toLocaleString("id-ID") : c + " " + n.toLocaleString(); }

// DealsView lists the user's deals and opens a RekberPanel for one.
function DealsView({ openThread, setOpenThread }: { openThread: number | null; setOpenThread: (id: number | null) => void }) {
  const profile = useProfile();
  const isMod = profile.has("chat.moderate");
  const [threads, setThreads] = useState<RekberThread[] | null>(null);
  const load = useCallback(() => { rekberApi.threads().then((r) => setThreads(r.threads ?? [])).catch(() => setThreads([])); }, []);
  useEffect(() => { load(); }, [load]);

  if (openThread !== null) return <RekberPanel threadId={openThread} onBack={() => { setOpenThread(null); load(); }} />;

  return (
    <div className="p-4">
      {isMod && <RekberAccountEditor />}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">My deals</h2>
        <button onClick={load} className="rounded-lg border border-white/10 p-1.5 text-white/50 hover:bg-white/5 hover:text-white"><RefreshCw className="h-3.5 w-3.5" /></button>
      </div>
      {!threads ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-white/40" /></div>
      ) : threads.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-xs text-white/40">No deals yet. Open one from a community listing.</div>
      ) : (
        <div className="space-y-2">
          {threads.map((t) => (
            <button key={t.id} onClick={() => setOpenThread(t.id)} className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-left hover:bg-white/[0.05]">
              <Handshake className="h-4 w-4 shrink-0 text-indigo-300" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-white">{t.title}</div>
                <div className="mt-0.5 text-[11px] text-white/45">{idrShort(t.amount, t.currency)} · {t.buyer.display_name || t.buyer.username} ↔ {t.seller.display_name || t.seller.username}</div>
              </div>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${t.status === "released" ? "bg-emerald-500/20 text-emerald-300" : t.status === "cancelled" || t.status === "disputed" ? "bg-red-500/20 text-red-300" : "bg-amber-500/20 text-amber-300"}`}>{STATUS_LABEL[t.status] ?? t.status}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// RekberPanel is the private deal chat: status stepper + messages + role-gated actions.
function RekberPanel({ threadId, onBack }: { threadId: number; onBack: () => void }) {
  const [thread, setThread] = useState<RekberThread | null>(null);
  const [role, setRole] = useState("");
  const [nextAct, setNextAct] = useState("");
  const [messages, setMessages] = useState<RekberMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [shipping, setShipping] = useState(false);
  const dialog = useDialog();
  const proof = useImageAttach();
  const lastId = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async (initial = false) => {
    try {
      const r = await rekberApi.get(threadId, initial ? 0 : lastId.current);
      setThread(r.thread);
      setRole(r.role);
      setNextAct(r.next_action);
      if (initial) setMessages(r.messages);
      else if (r.messages.length) setMessages((prev) => [...prev, ...r.messages]);
      if (r.messages.length) lastId.current = r.messages[r.messages.length - 1].id;
    } catch { /* ignore */ }
  }, [threadId]);

  useEffect(() => { lastId.current = 0; refresh(true); }, [refresh]);
  useEffect(() => { const iv = setInterval(() => refresh(false), 4000); return () => clearInterval(iv); }, [refresh]);
  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [messages]);

  const send = async () => {
    const c = text.trim();
    if (!c) return;
    setText("");
    try { await rekberApi.send(threadId, c); await refresh(false); } catch { /* ignore */ }
  };

  const runAction = async (action: string, extra: Record<string, unknown> = {}) => {
    // "mark-paid" requires a transfer proof image.
    if (action === "mark-paid" && proof.images.length === 0) {
      await dialog.alert({ title: "Attach transfer proof", message: "Upload the transfer proof before marking as paid." });
      return;
    }
    // "mark-shipped" opens the ship modal (fills the private goods).
    if (action === "mark-shipped" && !extra.content && !(extra.images as string[])?.length) {
      setShipping(true);
      return;
    }
    const confirmMsg: Record<string, string> = {
      "send-payment-info": "Send the rekber account details to the buyer?",
      "confirm-funds": "Confirm the buyer's payment has arrived?",
      "release": "Release funds to the seller? This is final.",
      "confirm-receipt": "Confirm the item was received? Funds will be released to the seller.",
    };
    if (confirmMsg[action]) {
      const ok = await dialog.confirm({ title: "Confirm", message: confirmMsg[action], confirmLabel: "Yes" });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const body = action === "mark-paid" ? { proof: proof.images } : extra;
      const t = await rekberApi.action(threadId, action, body);
      setThread(t);
      proof.clear();
      await refresh(false);
    } catch (e) {
      await dialog.alert({ title: "Failed", message: e instanceof Error ? e.message : "failed" });
    } finally {
      setBusy(false);
    }
  };

  if (!thread) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-white/40" /></div>;

  const stepIdx = STATUS_STEPS.indexOf(thread.status as typeof STATUS_STEPS[number]);
  const done = thread.status === "released";
  const dead = thread.status === "cancelled";
  const meta = nextAct ? ACTION_META[nextAct] : null;
  const ActIcon = meta?.icon;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/5 px-4 py-2.5">
        <button onClick={onBack} className="mb-2 flex items-center gap-1.5 text-xs text-white/50 hover:text-white"><ArrowLeft className="h-3.5 w-3.5" /> My deals</button>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{thread.title}</div>
          <div className="text-[11px] text-white/45">{idrShort(thread.amount, thread.currency)} · fee {idrShort(thread.fee, thread.currency)} · you: <span className="text-white/70">{role === "middleman" ? "middleman (founder)" : role || "observer"}</span></div>
        </div>
        {/* Seller payout (where the middleman releases funds) */}
        {thread.seller_payout && (
          <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] p-2 text-[11px]">
            <div className="mb-0.5 flex items-center gap-1 text-white/40"><Wallet className="h-3 w-3" /> Seller payout</div>
            {thread.seller_payout.kind === "qris" ? (
              <img src={thread.seller_payout.qris_url} alt="QRIS" onClick={() => openLightbox([thread.seller_payout!.qris_url], 0)} className="h-24 w-24 cursor-zoom-in rounded object-cover" />
            ) : (
              <div className="font-mono text-white/75">{thread.seller_payout.provider} · {thread.seller_payout.number} · a/n {thread.seller_payout.holder}</div>
            )}
          </div>
        )}
        {/* Status stepper */}
        <div className="mt-2 flex items-center gap-1">
          {STATUS_STEPS.map((s, i) => (
            <div key={s} className={`h-1.5 flex-1 rounded-full ${dead ? "bg-red-500/40" : i <= stepIdx ? "bg-emerald-400" : "bg-white/10"}`} />
          ))}
        </div>
        <div className="mt-1 text-[10px] text-white/40">Status: <span className="text-white/70">{STATUS_LABEL[thread.status] ?? thread.status}</span></div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-auto p-4">
        {messages.map((m) => m.kind === "system" ? (
          <div key={m.id} className="mx-auto w-fit max-w-[92%] whitespace-pre-wrap rounded-lg bg-white/5 px-3 py-1.5 text-center text-[11px] text-white/60">{m.content}</div>
        ) : (
          <div key={m.id} className="flex gap-2">
            <img src={m.avatar_url || "/favicon.png"} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
            <div className="min-w-0">
              <div className="text-[11px] text-white/50">{m.display_name || m.username}</div>
              {m.content && <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-sm text-white/85">{m.content}</div>}
              {m.images?.map((src, i) => <img key={i} src={src} alt="" onClick={() => openLightbox(m.images, i)} className="mt-1 max-h-40 cursor-zoom-in rounded-lg" />)}
            </div>
          </div>
        ))}
      </div>

      {/* Reminder: whose turn */}
      {!done && !dead && !meta && (
        <div className="border-t border-white/5 px-4 py-1.5 text-center text-[11px] text-amber-200/80">Waiting for the other party…</div>
      )}

      {/* Role-gated action */}
      {meta && !done && !dead && (
        <div className="border-t border-white/5 px-4 py-2">
          {nextAct === "mark-paid" && (
            <div className="mb-2 flex items-center gap-2">
              {proof.images.map((src, i) => (
                <div key={i} className="relative"><img src={src} alt="" className="h-12 w-12 rounded object-cover" /><button onClick={() => proof.removeAt(i)} className="absolute -right-1 -top-1 rounded-full bg-black/80 p-0.5 text-white/70"><X className="h-3 w-3" /></button></div>
              ))}
              <label className="flex cursor-pointer items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-white/60 hover:bg-white/10">
                <ImagePlus className="h-3.5 w-3.5" /> {proof.uploading ? "…" : "Transfer proof"}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => proof.upload(e.target.files)} />
              </label>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button onClick={() => runAction(nextAct)} disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-400 disabled:opacity-50">
              {ActIcon && <ActIcon className="h-3.5 w-3.5" />} {meta.label}
            </button>
            <button onClick={async () => { const ok = await dialog.confirm({ title: "Cancel deal?", message: "The deal will be cancelled.", confirmLabel: "Cancel deal", danger: true }); if (ok) runAction("cancel"); }} disabled={busy} className="ml-auto rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/50 hover:bg-red-500/15 hover:text-red-200">Cancel</button>
          </div>
        </div>
      )}

      {/* Buyer review prompt — only after the deal is released. */}
      {done && role === "buyer" && <ReviewPrompt threadId={threadId} />}

      {/* Composer */}
      {!dead && (
        <div className="flex items-center gap-2 border-t border-white/5 px-4 py-2.5">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Message…" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/25" />
          <button onClick={send} className="rounded-lg bg-white/10 p-2 text-white/70 hover:bg-white/20"><Send className="h-4 w-4" /></button>
        </div>
      )}
      {shipping && <ShipModal onClose={() => setShipping(false)} onShip={(content, images) => { setShipping(false); runAction("mark-shipped", { content, images }); }} />}
    </div>
  );
}

// ReviewPrompt lets the buyer rate the seller once, after a completed deal.
function ReviewPrompt({ threadId }: { threadId: number }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [body, setBody] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (done) return <div className="border-t border-white/5 px-4 py-2 text-center text-[11px] text-emerald-300">Thanks for your review!</div>;

  const submit = async () => {
    if (rating < 1) { setErr("Pick a star rating."); return; }
    setBusy(true); setErr("");
    try {
      await reviewApi.submit(threadId, rating, body.trim());
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-white/5 px-4 py-2.5">
      <div className="mb-1.5 text-[11px] font-medium text-white/60">Rate the seller</div>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)} onClick={() => setRating(n)}>
            <Star className={`h-5 w-5 ${(hover || rating) >= n ? "fill-amber-300 text-amber-300" : "text-white/25"}`} />
          </button>
        ))}
      </div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Share your experience (optional)…" className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-white outline-none focus:border-white/25" />
      {err && <div className="mt-1 text-[11px] text-red-300">{err}</div>}
      <button onClick={submit} disabled={busy} className="mt-2 rounded-lg bg-amber-500/90 px-3 py-1.5 text-xs font-medium text-black hover:bg-amber-400 disabled:opacity-50">{busy ? "Submitting…" : "Submit review"}</button>
    </div>
  );
}

// ShipModal: the seller fills in the private goods (content + images) when shipping.
function ShipModal({ onClose, onShip }: { onClose: () => void; onShip: (content: string, images: string[]) => void }) {
  const [content, setContent] = useState("");
  const img = useImageAttach();
  const [err, setErr] = useState("");
  const submit = () => {
    if (!content.trim() && img.images.length === 0) { setErr("Fill in the item details or attach a file."); return; }
    onShip(content.trim(), img.images);
  };
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#11131a] shadow-2xl" onClick={(e) => e.stopPropagation()} onPaste={img.onPaste}>
        <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
          <div className="min-w-0 flex-1 text-sm font-semibold text-white">Ship item</div>
          <button onClick={onClose} className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 p-4">
          <p className="text-[11px] text-white/40">Only the buyer & seller can see this — the middleman/admin cannot.</p>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5} placeholder="akun@email:password&#10;resi JNE 1234567&#10;link download…" className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white outline-none focus:border-white/25" />
          {img.images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {img.images.map((src, i) => (
                <div key={i} className="relative"><img src={src} alt="" className="h-14 w-14 rounded object-cover" /><button onClick={() => img.removeAt(i)} className="absolute -right-1 -top-1 rounded-full bg-black/80 p-0.5 text-white/70"><X className="h-3 w-3" /></button></div>
              ))}
            </div>
          )}
          <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-white/60 hover:bg-white/10">
            <ImagePlus className="h-3.5 w-3.5" /> {img.uploading ? "…" : "Attach image"}
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => img.upload(e.target.files)} />
          </label>
          {err && <div className="text-xs text-red-300">{err}</div>}
          <button onClick={submit} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-400"><Send className="h-4 w-4" /> Ship item</button>
        </div>
      </div>
    </div>
  );
}

// OrdersView lists the user's official-store orders + private rekber deliveries.
function OrdersView() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [rekber, setRekber] = useState<RekberOrder[]>([]);
  const dialog = useDialog();
  const load = useCallback(() => {
    orderApi.list().then((r) => setOrders(r.orders ?? [])).catch(() => setOrders([]));
    rekberApi.orders().then((r) => setRekber(r.orders ?? [])).catch(() => setRekber([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  // Poll while any order is still pending (waiting for the gateway callback).
  useEffect(() => {
    if (!orders?.some((o) => o.status === "pending")) return;
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [orders, load]);

  const copy = (s: string) => { navigator.clipboard?.writeText(s); };

  const badge = (s: string) => s === "delivered" ? "bg-emerald-500/20 text-emerald-300" : s === "pending" ? "bg-amber-500/20 text-amber-300" : "bg-red-500/20 text-red-300";

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">My orders</h2>
        <button onClick={load} className="rounded-lg border border-white/10 p-1.5 text-white/50 hover:bg-white/5 hover:text-white"><RefreshCw className="h-3.5 w-3.5" /></button>
      </div>
      {!orders ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-white/40" /></div>
      ) : orders.length === 0 && rekber.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-xs text-white/40">No orders yet.</div>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => (
            <div key={"vip" + o.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-white">{o.title}</div>
                  <div className="mt-0.5 text-[11px] text-white/45">{idr(o.amount, o.currency)} · {o.order_ref}</div>
                </div>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${badge(o.status)}`}>{o.status}</span>
              </div>
              {o.status === "delivered" && o.delivered_payload && (
                <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] p-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase text-emerald-300/80">Delivered</span>
                    <button onClick={() => copy(o.delivered_payload!)} className="flex items-center gap-1 text-[10px] text-white/50 hover:text-white"><Copy className="h-3 w-3" /> Copy</button>
                  </div>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-white/80">{o.delivered_payload}</pre>
                </div>
              )}
              {o.status === "pending" && o.pay_url && (
                <button onClick={() => window.open(o.pay_url!, "_blank", "noopener")} className="mt-2 flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-white/70 hover:bg-white/10"><ExternalLink className="h-3.5 w-3.5" /> Continue payment</button>
              )}
            </div>
          ))}
          {rekber.map((o) => (
            <div key={"rk" + o.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-white">{o.title} — {o.counterpart}</div>
                  <div className="mt-0.5 text-[11px] text-white/45">{idr(o.amount, o.currency)} · rekber ({o.role === "buyer" ? "bought from" : "sold to"} {o.counterpart})</div>
                </div>
                <span className="shrink-0 rounded bg-indigo-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-indigo-300">{STATUS_LABEL[o.status] ?? o.status}</span>
              </div>
              <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase text-emerald-300/80">Item</span>
                  {o.content && <button onClick={() => copy(o.content)} className="flex items-center gap-1 text-[10px] text-white/50 hover:text-white"><Copy className="h-3 w-3" /> Copy</button>}
                </div>
                {o.content && <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-white/80">{o.content}</pre>}
                {o.images?.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1.5">{o.images.map((src, i) => <img key={i} src={src} alt="" onClick={() => openLightbox(o.images, i)} className="h-16 w-16 cursor-zoom-in rounded object-cover" />)}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
      <span className="hidden">{typeof dialog}</span>
    </div>
  );
}

// OfficialStore renders curated VIP products grouped by brand + a dynamic buy form.
function OfficialStore({ onBought }: { onBought: () => void }) {
  const [products, setProducts] = useState<OfficialProduct[] | null>(null);
  const [buying, setBuying] = useState<OfficialProduct | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => { officialApi.list().then((r) => { setProducts(r?.products ?? []); setErr(""); }).catch((e) => { setErr(e instanceof Error ? e.message : "failed"); setProducts([]); }); }, []);
  useEffect(() => { load(); }, [load]);

  const groups = (() => {
    const g: Record<string, OfficialProduct[]> = {};
    for (const p of products ?? []) { (g[p.brand || p.category || "Other"] ??= []).push(p); }
    return g;
  })();

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Official Store</h2>
        <button onClick={load} className="rounded-lg border border-white/10 p-1.5 text-white/50 hover:bg-white/5 hover:text-white"><RefreshCw className="h-3.5 w-3.5" /></button>
      </div>
      {err && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{err}</div>}
      {!products ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-white/40" /></div>
      ) : products.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-xs text-white/40">No products yet. (Admins curate these from the VIP catalog.)</div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groups).map(([brand, items]) => (
            <div key={brand}>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/40">{brand}</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {items.map((p) => (
                  <button key={p.id} onClick={() => setBuying(p)} className="rounded-xl border border-white/10 bg-white/[0.02] p-2.5 text-left hover:border-white/20">
                    <div className="truncate text-xs font-medium text-white">{p.name}</div>
                    <div className="mt-0.5 text-sm font-semibold text-emerald-300">{idr(p.sell_price, "IDR")}</div>
                    <div className="mt-1 text-[9px] uppercase text-white/30">{p.category}{p.needs_zone ? " · needs zone" : ""}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {buying && <BuyModal product={buying} onClose={() => setBuying(null)} onBought={onBought} />}
    </div>
  );
}

function BuyModal({ product, onClose, onBought }: { product: OfficialProduct; onClose: () => void; onBought: () => void }) {
  const [dataNo, setDataNo] = useState("");
  const [dataZone, setDataZone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!dataNo.trim()) { setErr("Target (number / user ID) is required"); return; }
    if (product.needs_zone && !dataZone.trim()) { setErr("Zone / server is required"); return; }
    setBusy(true); setErr("");
    try {
      const o = await orderApi.create(product.service_code, dataNo.trim(), dataZone.trim());
      if (o.pay_url) window.open(o.pay_url, "_blank", "noopener");
      onBought();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-[#11131a] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white">{product.name}</div>
            <div className="text-sm font-bold text-emerald-300">{idr(product.sell_price, "IDR")}</div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <label className="mb-1 block text-[11px] text-white/50">{product.kind === "game" ? "User ID" : "Target number (HP / ID pelanggan)"}</label>
            <input value={dataNo} onChange={(e) => setDataNo(e.target.value)} placeholder={product.kind === "game" ? "12345678" : "08xxxxxxxxxx"} className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/25" />
          </div>
          {product.needs_zone && (
            <div>
              <label className="mb-1 block text-[11px] text-white/50">Zone / Server</label>
              <input value={dataZone} onChange={(e) => setDataZone(e.target.value)} placeholder="e.g. 2001" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/25" />
            </div>
          )}
          {err && <div className="text-xs text-red-300">{err}</div>}
          <button onClick={submit} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-400 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />} Pay {idr(product.sell_price, "IDR")}
          </button>
          <p className="text-center text-[10px] text-white/30">You'll be redirected to the payment gateway. Delivery is automatic.</p>
        </div>
      </div>
    </div>
  );
}

// RekberAccountEditor (founder/moderator) sets the global rekber transfer account
// (text + images such as a QRIS code).
function RekberAccountEditor() {
  const [account, setAccount] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const img = useImageAttach();

  useEffect(() => { rekberApi.account.get().then((r) => { setAccount(r.account || ""); setImages(r.images || []); }).catch(() => {}); }, []);

  const save = async () => {
    const imgs = [...images, ...img.images];
    try { await rekberApi.account.set(account, imgs); setImages(imgs); img.clear(); setSaved(true); setEditing(false); setTimeout(() => setSaved(false), 2000); } catch { /* ignore */ }
  };

  return (
    <div className="mb-3 rounded-xl border border-indigo-500/20 bg-indigo-500/[0.05] p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-indigo-300/80">Rekber account (middleman)</span>
        {saved && <span className="flex items-center gap-1 text-[10px] text-emerald-300"><Check className="h-3 w-3" /> Saved</span>}
      </div>
      {editing ? (
        <>
          <textarea value={account} onChange={(e) => setAccount(e.target.value)} rows={3} placeholder="BCA 1234567890 a.n. Nama Founder&#10;DANA 0812xxxx" className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white outline-none focus:border-white/25" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {images.map((src, i) => (
              <div key={src} className="relative"><img src={src} alt="" className="h-14 w-14 rounded object-cover" /><button onClick={() => setImages(images.filter((_, j) => j !== i))} className="absolute -right-1 -top-1 rounded-full bg-black/80 p-0.5 text-white/70"><X className="h-3 w-3" /></button></div>
            ))}
            {img.images.map((src, i) => (
              <div key={src} className="relative"><img src={src} alt="" className="h-14 w-14 rounded object-cover" /><button onClick={() => img.removeAt(i)} className="absolute -right-1 -top-1 rounded-full bg-black/80 p-0.5 text-white/70"><X className="h-3 w-3" /></button></div>
            ))}
            <label className="flex h-14 w-14 cursor-pointer flex-col items-center justify-center rounded border border-dashed border-white/15 text-white/40 hover:bg-white/5">
              {img.uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
              <span className="mt-0.5 text-[8px]">QRIS</span>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => img.upload(e.target.files)} />
            </label>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <button onClick={() => { setEditing(false); img.clear(); }} className="rounded-lg px-2.5 py-1 text-[11px] text-white/50 hover:text-white">Cancel</button>
            <button onClick={save} className="rounded-lg bg-white px-3 py-1 text-[11px] font-medium text-black hover:opacity-90">Save</button>
          </div>
        </>
      ) : (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <pre className="truncate whitespace-pre-wrap font-mono text-[11px] text-white/70">{account || "Not set yet — the buyer needs this to transfer."}</pre>
            {images.length > 0 && <div className="mt-1.5 flex gap-1.5">{images.map((src, i) => <img key={i} src={src} alt="" onClick={() => openLightbox(images, i)} className="h-12 w-12 cursor-zoom-in rounded object-cover" />)}</div>}
          </div>
          <button onClick={() => setEditing(true)} className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-white/60 hover:bg-white/5">Edit</button>
        </div>
      )}
    </div>
  );
}
