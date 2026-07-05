import { useEffect, useRef, useState } from "react";
import { Loader2, Upload, Download, Search, X, Check, Copy, FolderOpen, FileText } from "lucide-react";
import { AppShell } from "./shell";
import { useDialog } from "../os/dialog";
import { copyText } from "../os/clipboard";
import { useProfile } from "../os/useProfile";
import { registryApi, type RegistryItem, type RegistryFile } from "../lib/api";

// --- helpers: read a picked skill directory + parse SKILL.md frontmatter ---

interface PickedSkill {
  root: string; // the top folder name (used as fallback slug/name)
  files: RegistryFile[]; // base64, paths relative to the skill root
  meta: { name?: string; description?: string; version?: string };
}

// bytesToBase64 encodes bytes without blowing the call stack on large files.
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// parseFrontmatter pulls name/description/version out of a SKILL.md YAML header.
function parseFrontmatter(md: string): { name?: string; description?: string; version?: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_]+)\s*:\s*(.*)$/);
    if (kv) out[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { name: out.name, description: out.description, version: out.version };
}

// readSkillDir reads a picked directory (webkitdirectory) into base64 files with
// paths relative to the skill root, and auto-detects metadata from SKILL.md.
async function readSkillDir(fileList: FileList): Promise<PickedSkill> {
  const all = Array.from(fileList);
  // webkitRelativePath is like "<root>/sub/file"; strip the leading root folder.
  const root = all[0]?.webkitRelativePath.split("/")[0] ?? "skill";
  const files: RegistryFile[] = [];
  let skillMd = "";
  for (const f of all) {
    const rel = f.webkitRelativePath.split("/").slice(1).join("/");
    if (!rel || f.size > 2 * 1024 * 1024) continue; // skip empty paths + huge files
    const buf = new Uint8Array(await f.arrayBuffer());
    files.push({ path: rel, content: bytesToBase64(buf) });
    if (rel.toLowerCase() === "skill.md") skillMd = new TextDecoder().decode(buf);
  }
  return { root, files, meta: parseFrontmatter(skillMd) };
}

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
  const [picked, setPicked] = useState<PickedSkill | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const dirRef = useRef<HTMLInputElement>(null);

  const onPick = async (fl: FileList | null) => {
    if (!fl || fl.length === 0) return;
    setErr("");
    const skill = await readSkillDir(fl);
    setPicked(skill);
    // Auto-fill from SKILL.md (still editable). Fall back to the folder name.
    setName(skill.meta.name?.trim() || skill.root);
    setDesc(skill.meta.description?.trim() || "");
    setVersion(skill.meta.version?.trim() || "1.0.0");
  };

  const submit = async () => {
    if (!name.trim() || !picked || busy) return;
    setBusy(true); setErr("");
    try {
      const r = await registryApi.publish({
        kind: "skill",
        name: name.trim(),
        description: desc.trim(),
        version: version.trim() || "1.0.0",
        files: picked.files,
      });
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
            <p className="text-[11px] text-white/40">Pick your skill folder — name, description and version are read from its <code className="text-white/60">SKILL.md</code>. Files are scanned, then published to the community registry.</p>

            {/* Folder picker. webkitdirectory selects the whole folder. */}
            <button onClick={() => dirRef.current?.click()} className="flex w-full items-center gap-2 rounded-lg border border-dashed border-white/15 bg-black/20 px-3 py-3 text-xs text-white/70 hover:bg-white/5">
              <FolderOpen className="h-4 w-4 shrink-0 text-white/40" />
              {picked ? (
                <span className="flex items-center gap-1.5 truncate"><span className="font-medium text-white">{picked.root}</span><span className="text-white/40">· {picked.files.length} files</span></span>
              ) : (
                <span>Choose skill folder…</span>
              )}
            </button>
            {/* @ts-expect-error webkitdirectory is a valid non-standard attr */}
            <input ref={dirRef} type="file" webkitdirectory="" directory="" multiple className="hidden" onChange={(e) => onPick(e.target.files)} />

            {picked && (
              <>
                {picked.meta.name && (
                  <p className="flex items-center gap-1 text-[10px] text-emerald-300/80"><FileText className="h-3 w-3" /> Detected from SKILL.md</p>
                )}
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/25" />
                <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Short description" rows={2} className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-white/25" />
                <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="Version" className="w-28 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-white/25" />
              </>
            )}
            {err && <p className="text-[11px] text-red-300">{err}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-white/50 hover:bg-white/5">Cancel</button>
              <button onClick={submit} disabled={busy || !name.trim() || !picked} className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black hover:opacity-90 disabled:opacity-40">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Publish
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
