import { useEffect, useRef, useState } from "react";
import { Loader2, Upload, Download, Search, X, Check, Copy } from "lucide-react";
import { AppShell } from "./shell";
import { useDialog } from "../os/dialog";
import { copyText } from "../os/clipboard";
import { useProfile } from "../os/useProfile";
import { registryApi, type RegistryItem } from "../lib/api";

// SkillApp: a community registry where anyone can upload + browse Skills. A
// searchable grid + an upload button. Uploads are scanned server-side, then
// committed to the enowX-Skill GitHub repo.
export function SkillApp() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<RegistryItem[] | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = () => {
    setItems(null);
    registryApi.list("skill", q).then((r) => setItems(r.items ?? [])).catch(() => setItems([]));
  };
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <AppShell title="Skills" subtitle="Community skill registry — upload & browse">
      <div className="flex h-full flex-col gap-3">
        {/* Search + upload. */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search skills…"
              className="w-full rounded-lg border border-white/10 bg-black/25 py-1.5 pl-8 pr-3 text-xs text-white/80 outline-none focus:border-white/25"
            />
          </div>
          <button onClick={() => setUploading(true)} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black hover:opacity-90">
            <Upload className="h-3.5 w-3.5" /> Upload
          </button>
        </div>

        {/* Grid. */}
        <div className="min-h-0 flex-1 overflow-auto">
          {items === null ? (
            <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-white/30" /></div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center text-xs text-white/40">
              {q ? "No matches." : "No skills yet — be the first to upload one."}
            </div>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
              {items.map((it) => <ItemCard key={it.id} item={it} />)}
            </div>
          )}
        </div>
      </div>

      {uploading && <UploadModal onClose={() => setUploading(false)} onDone={() => { setUploading(false); load(); }} />}
    </AppShell>
  );
}

function ItemCard({ item }: { item: RegistryItem }) {
  const [copied, setCopied] = useState(false);
  const copyInstall = () => {
    copyText(`enx skill install ${item.slug}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white">{item.name}</div>
          <div className="text-[10px] text-white/40">by {item.author} · v{item.version}</div>
        </div>
        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-white/40">{item.downloads} ↓</span>
      </div>
      {item.description && <p className="mt-1.5 line-clamp-2 text-[11px] text-white/55">{item.description}</p>}
      <div className="mt-2.5 flex items-center gap-1.5">
        <button onClick={copyInstall} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 py-1.5 text-[11px] text-white/75 hover:bg-white/10" title="Copy install command">
          {copied ? <Check className="h-3 w-3 text-emerald-300" /> : <Copy className="h-3 w-3" />} enx install
        </button>
        <a href={item.download_url} target="_blank" rel="noreferrer" onClick={() => registryApi.get(item.id).catch(() => {})} className="flex items-center justify-center rounded-lg border border-white/10 bg-white/5 p-1.5 text-white/60 hover:bg-white/10" title="Download bundle">
          <Download className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}

function UploadModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const profile = useProfile();
  const dialog = useDialog();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!name.trim() || !file || busy) return;
    setBusy(true); setErr("");
    try {
      const fd = new FormData();
      fd.append("kind", "skill");
      fd.append("name", name.trim());
      fd.append("description", desc.trim());
      fd.append("version", version.trim() || "1.0.0");
      fd.append("file", file);
      const r = await registryApi.publish(fd);
      if (r.status === "rejected") {
        setErr(r.reason || "Rejected by the security scan.");
        return;
      }
      dialog.alert({ title: "Published 🎉", message: `Your skill "${name.trim()}" is live.` });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "upload failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[10600] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#0e1016] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h3 className="text-sm font-semibold text-white">Upload Skill</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        {!profile.loggedIn ? (
          <div className="p-6 text-center text-xs text-white/50">Sign in to the cloud to upload.</div>
        ) : (
          <div className="space-y-3 p-4">
            <p className="text-[11px] text-white/40">Uploads are scanned before they go live, then published to the community registry.</p>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/25" />
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Short description" rows={2} className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-white/25" />
            <div className="flex gap-2">
              <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="Version" className="w-28 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-white/25" />
              <button onClick={() => fileRef.current?.click()} className="flex flex-1 items-center gap-2 truncate rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/70 hover:bg-white/5">
                <Upload className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{file ? file.name : "Choose bundle (.zip)"}</span>
              </button>
              <input ref={fileRef} type="file" accept=".zip" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
            {err && <p className="text-[11px] text-red-300">{err}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-white/50 hover:bg-white/5">Cancel</button>
              <button onClick={submit} disabled={busy || !name.trim() || !file} className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black hover:opacity-90 disabled:opacity-40">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Publish
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
