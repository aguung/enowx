import { useCallback, useEffect, useRef, useState } from "react";
import { Store, ShieldCheck, Plus, X, Search, RefreshCw, Loader2, Trash2, ImagePlus, ArrowLeft, Tag, Handshake, Send, Check, CircleDollarSign, ShoppingCart, ExternalLink, Copy } from "lucide-react";
import { marketplaceApi, rekberApi, orderApi, type Listing, type ListingCategory, type RekberThread, type RekberMessage, type Order } from "../lib/api";
import { useProfile } from "../os/useProfile";
import { useImageAttach } from "../os/useImageAttach";
import { useDialog } from "../os/dialog";
import { openLightbox } from "../os/lightbox";
import { openProfile } from "../os/profileViewer";

type Kind = "community" | "official";
type View = "browse" | "deals" | "orders";

function idr(amount: number, currency: string) {
  if (currency === "IDR") return "Rp " + amount.toLocaleString("id-ID");
  return currency + " " + amount.toLocaleString();
}

export function MarketplaceApp() {
  const [view, setView] = useState<View>("browse");
  const [kind, setKind] = useState<Kind>("community");
  const [detail, setDetail] = useState<Listing | null>(null);
  const [creating, setCreating] = useState(false);
  const [openThread, setOpenThread] = useState<number | null>(null);

  const openDeal = (id: number) => { setOpenThread(id); setView("deals"); };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2.5">
        <button onClick={() => { setView("browse"); setKind("official"); }} className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${view === "browse" && kind === "official" ? "bg-white/12 text-white" : "text-white/50 hover:bg-white/5"}`}><ShieldCheck className="h-3.5 w-3.5" /> Official Store</button>
        <button onClick={() => { setView("browse"); setKind("community"); }} className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${view === "browse" && kind === "community" ? "bg-white/12 text-white" : "text-white/50 hover:bg-white/5"}`}><Store className="h-3.5 w-3.5" /> Community</button>
        <button onClick={() => { setView("deals"); setOpenThread(null); }} className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${view === "deals" ? "bg-white/12 text-white" : "text-white/50 hover:bg-white/5"}`}><Handshake className="h-3.5 w-3.5" /> My Deals</button>
        <button onClick={() => setView("orders")} className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${view === "orders" ? "bg-white/12 text-white" : "text-white/50 hover:bg-white/5"}`}><ShoppingCart className="h-3.5 w-3.5" /> My Orders</button>
        <button onClick={() => setCreating(true)} className="ml-auto flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black hover:opacity-90"><Plus className="h-3.5 w-3.5" /> Sell</button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {view === "orders" ? (
          <OrdersView />
        ) : view === "deals" ? (
          <DealsView openThread={openThread} setOpenThread={setOpenThread} />
        ) : detail ? (
          <ListingDetail listing={detail} onBack={() => setDetail(null)} onDeleted={() => setDetail(null)} onDeal={openDeal} />
        ) : (
          <Feed kind={kind} onOpen={setDetail} />
        )}
      </div>
      {creating && <SellModal initialKind={kind} onClose={() => setCreating(false)} onCreated={() => setCreating(false)} />}
    </div>
  );
}

function Feed({ kind, onOpen }: { kind: Kind; onOpen: (l: Listing) => void }) {
  const [items, setItems] = useState<Listing[] | null>(null);
  const [cats, setCats] = useState<ListingCategory[]>([]);
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");

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
  useEffect(() => { setItems(null); load(); }, [load]);

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
          {items.map((l) => <ListingCard key={l.id} l={l} onOpen={() => onOpen(l)} />)}
        </div>
      )}
    </div>
  );
}

function ListingCard({ l, onOpen }: { l: Listing; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="group overflow-hidden rounded-xl border border-white/10 bg-white/[0.02] text-left hover:border-white/20">
      <div className="aspect-video w-full overflow-hidden bg-white/5">
        {l.images[0] ? (
          <img src={l.images[0]} alt="" className="h-full w-full object-cover transition group-hover:scale-105" />
        ) : (
          <div className="flex h-full items-center justify-center text-white/20"><Tag className="h-6 w-6" /></div>
        )}
      </div>
      <div className="p-2.5">
        <div className="truncate text-xs font-medium text-white">{l.title}</div>
        <div className="mt-0.5 text-sm font-semibold text-emerald-300">{idr(l.price_amount, l.currency)}</div>
        <div className="mt-1 truncate text-[10px] text-white/35">by {l.display_name || l.username}</div>
      </div>
    </button>
  );
}

function ListingDetail({ listing, onBack, onDeleted, onDeal }: { listing: Listing; onBack: () => void; onDeleted: () => void; onDeal: (threadId: number) => void }) {
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
      onDeal(t.id);
    } catch (e) {
      await dialog.alert({ title: "Couldn't start deal", message: e instanceof Error ? e.message : "failed" });
    } finally {
      setDealing(false);
    }
  };

  const buy = async () => {
    setDealing(true);
    try {
      const o = await orderApi.create(listing.id);
      if (o.pay_url) window.open(o.pay_url, "_blank", "noopener");
      await dialog.alert({ title: "Payment opened", message: "Complete the payment in the new tab. Your order will be delivered automatically — check My Orders." });
    } catch (e) {
      await dialog.alert({ title: "Couldn't start order", message: e instanceof Error ? e.message : "failed" });
    } finally {
      setDealing(false);
    }
  };

  const remove = async () => {
    const ok = await dialog.confirm({ title: "Delete listing?", message: `"${listing.title}" will be removed.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    setBusy(true);
    try { await marketplaceApi.remove(listing.id); onDeleted(); } catch { /* ignore */ } finally { setBusy(false); }
  };

  return (
    <div className="p-4">
      <button onClick={onBack} className="mb-3 flex items-center gap-1.5 text-xs text-white/50 hover:text-white"><ArrowLeft className="h-3.5 w-3.5" /> Back</button>
      <div className="mx-auto max-w-2xl">
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
        <button onClick={() => openProfile(listing.user_id)} className="mt-1.5 text-xs text-white/50 hover:underline">Seller: {listing.display_name || listing.username}</button>
        {listing.warranty && <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2 text-[11px] text-emerald-200/90">Warranty: {listing.warranty}</div>}
        {listing.description && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-white/70">{listing.description}</p>}
        <div className="mt-4 flex gap-2">
          {listing.kind === "official" ? (
            <button onClick={buy} disabled={dealing} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-400 disabled:opacity-50">
              {dealing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />} Buy now
            </button>
          ) : mine ? (
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

function SellModal({ initialKind, onClose, onCreated }: { initialKind: Kind; onClose: () => void; onCreated: () => void }) {
  const profile = useProfile();
  const canOfficial = profile.has("chat.moderate");
  const [kind, setKind] = useState<Kind>(canOfficial ? initialKind : "community");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("other");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [warranty, setWarranty] = useState("");
  const [stock, setStock] = useState("1");
  const [payload, setPayload] = useState("");
  const [cats, setCats] = useState<ListingCategory[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const img = useImageAttach();

  useEffect(() => { marketplaceApi.list({ kind: "community" }).then((r) => setCats(r?.categories ?? [])).catch(() => {}); }, []);

  const submit = async () => {
    if (!title.trim()) { setErr("Title required"); return; }
    setSaving(true); setErr("");
    try {
      await marketplaceApi.create({
        kind, category, title: title.trim(), description: description.trim(),
        images: img.images, price_amount: Math.max(0, parseInt(price || "0", 10) || 0),
        currency: "IDR", stock: Math.max(0, parseInt(stock || "1", 10) || 0), warranty: warranty.trim(),
        ...(kind === "official" ? { delivery_payload: payload } : {}),
      });
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to create");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[90%] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#11131a] shadow-2xl" onClick={(e) => e.stopPropagation()} onPaste={img.onPaste}>
        <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
          <div className="flex-1 text-sm font-semibold text-white">New listing</div>
          <button onClick={onClose} className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
          {canOfficial && (
            <div className="flex gap-1">
              <button onClick={() => setKind("community")} className={`rounded-lg px-2.5 py-1 text-xs ${kind === "community" ? "bg-white/12 text-white" : "text-white/45"}`}>Community</button>
              <button onClick={() => setKind("official")} className={`rounded-lg px-2.5 py-1 text-xs ${kind === "official" ? "bg-white/12 text-white" : "text-white/45"}`}>Official</button>
            </div>
          )}
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
          {kind === "official" && (
            <div>
              <label className="mb-1 block text-[11px] text-white/50">Delivery payload (given to the buyer after payment — e.g. credentials)</label>
              <textarea value={payload} onChange={(e) => setPayload(e.target.value)} placeholder="secret@example.com:password&#10;..." rows={3} className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white outline-none focus:border-white/25" />
            </div>
          )}
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
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Publish
          </button>
        </div>
      </div>
    </div>
  );
}

const STATUS_STEPS = ["open", "buyer_paid", "delivered", "released"] as const;
const STATUS_LABEL: Record<string, string> = {
  open: "Opened", buyer_paid: "Buyer paid", delivered: "Delivered", released: "Released",
  cancelled: "Cancelled", disputed: "Disputed",
};

function idrShort(n: number, c: string) { return c === "IDR" ? "Rp " + n.toLocaleString("id-ID") : c + " " + n.toLocaleString(); }

// DealsView lists the user's deals and opens a RekberPanel for one.
function DealsView({ openThread, setOpenThread }: { openThread: number | null; setOpenThread: (id: number | null) => void }) {
  const [threads, setThreads] = useState<RekberThread[] | null>(null);
  const load = useCallback(() => { rekberApi.threads().then((r) => setThreads(r.threads ?? [])).catch(() => setThreads([])); }, []);
  useEffect(() => { load(); }, [load]);

  if (openThread !== null) return <RekberPanel threadId={openThread} onBack={() => { setOpenThread(null); load(); }} />;

  return (
    <div className="p-4">
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
  const [messages, setMessages] = useState<RekberMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const dialog = useDialog();
  const lastId = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async (initial = false) => {
    try {
      const r = await rekberApi.get(threadId, initial ? 0 : lastId.current);
      setThread(r.thread);
      setRole(r.role);
      if (initial) setMessages(r.messages);
      else if (r.messages.length) setMessages((prev) => [...prev, ...r.messages]);
      if (r.messages.length) lastId.current = r.messages[r.messages.length - 1].id;
    } catch { /* ignore */ }
  }, [threadId]);

  useEffect(() => { lastId.current = 0; refresh(true); }, [refresh]);
  // Poll for new messages/status while open.
  useEffect(() => {
    const iv = setInterval(() => refresh(false), 4000);
    return () => clearInterval(iv);
  }, [refresh]);
  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [messages]);

  const send = async () => {
    const c = text.trim();
    if (!c) return;
    setText("");
    try { await rekberApi.send(threadId, c); await refresh(false); } catch { /* ignore */ }
  };

  const act = async (fn: () => Promise<RekberThread>) => {
    setBusy(true);
    try { const t = await fn(); setThread(t); await refresh(false); } catch (e) { await dialog.alert({ title: "Action failed", message: e instanceof Error ? e.message : "failed" }); } finally { setBusy(false); }
  };

  if (!thread) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-white/40" /></div>;

  const stepIdx = STATUS_STEPS.indexOf(thread.status as typeof STATUS_STEPS[number]);
  const done = thread.status === "released";
  const dead = thread.status === "cancelled" || thread.status === "disputed";

  // Role-gated primary action.
  let action: { label: string; icon: typeof Check; fn: () => Promise<RekberThread> } | null = null;
  if (!done && !dead) {
    if (role === "buyer" && thread.status === "open") action = { label: "Sudah bayar", icon: Check, fn: () => rekberApi.advance(threadId) };
    else if (role === "buyer" && thread.status === "delivered") action = { label: "Konfirmasi terima", icon: Check, fn: () => rekberApi.advance(threadId) };
    else if (role === "seller" && thread.status === "buyer_paid") action = { label: "Sudah kirim", icon: Send, fn: () => rekberApi.advance(threadId) };
    else if (role === "middleman" && thread.status === "delivered") action = { label: "Send Payment", icon: CircleDollarSign, fn: () => rekberApi.advance(threadId) };
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/5 px-4 py-2.5">
        <button onClick={onBack} className="mb-2 flex items-center gap-1.5 text-xs text-white/50 hover:text-white"><ArrowLeft className="h-3.5 w-3.5" /> My deals</button>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white">{thread.title}</div>
            <div className="text-[11px] text-white/45">{idrShort(thread.amount, thread.currency)} · fee {idrShort(thread.fee, thread.currency)} · you are the <span className="text-white/70">{role || "observer"}</span></div>
          </div>
        </div>
        {/* Status stepper */}
        <div className="mt-2 flex items-center gap-1">
          {STATUS_STEPS.map((s, i) => (
            <div key={s} className="flex flex-1 items-center gap-1">
              <div className={`h-1.5 flex-1 rounded-full ${dead ? "bg-red-500/40" : i <= stepIdx ? "bg-emerald-400" : "bg-white/10"}`} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[9px] text-white/40">
          {STATUS_STEPS.map((s) => <span key={s}>{STATUS_LABEL[s]}</span>)}
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-auto p-4">
        {messages.map((m) => m.kind === "system" ? (
          <div key={m.id} className="mx-auto w-fit max-w-[90%] rounded-full bg-white/5 px-3 py-1 text-center text-[11px] text-white/50">{m.content}</div>
        ) : (
          <div key={m.id} className="flex gap-2">
            <img src={m.avatar_url || "/favicon.png"} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
            <div className="min-w-0">
              <div className="text-[11px] text-white/50">{m.display_name || m.username}</div>
              <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-sm text-white/85">{m.content}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      {(action || (!done && !dead)) && (
        <div className="flex items-center gap-2 border-t border-white/5 px-4 py-2">
          {action && (
            <button onClick={() => act(action!.fn)} disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-400 disabled:opacity-50">
              <action.icon className="h-3.5 w-3.5" /> {action.label}
            </button>
          )}
          {!done && !dead && (
            <button onClick={() => act(() => rekberApi.cancel(threadId))} disabled={busy} className="ml-auto rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/50 hover:bg-red-500/15 hover:text-red-200">Cancel</button>
          )}
        </div>
      )}

      {/* Composer */}
      {!dead && (
        <div className="flex items-center gap-2 border-t border-white/5 px-4 py-2.5">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Message…" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/25" />
          <button onClick={send} className="rounded-lg bg-white/10 p-2 text-white/70 hover:bg-white/20"><Send className="h-4 w-4" /></button>
        </div>
      )}
    </div>
  );
}

// OrdersView lists the user's official-store orders + their delivered payload.
function OrdersView() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const dialog = useDialog();
  const load = useCallback(() => { orderApi.list().then((r) => setOrders(r.orders ?? [])).catch(() => setOrders([])); }, []);
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
      ) : orders.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-xs text-white/40">No orders yet. Buy something from the Official Store.</div>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => (
            <div key={o.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
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
        </div>
      )}
      <p className="mt-3 text-[10px] text-white/30">Payments are handled by the gateway; orders deliver automatically once paid.</p>
      {/* dialog kept for future confirm flows */}
      <span className="hidden">{typeof dialog}</span>
    </div>
  );
}
