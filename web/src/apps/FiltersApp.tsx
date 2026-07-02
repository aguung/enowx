import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, ArrowRight, Loader2, BookmarkPlus, ChevronDown } from "lucide-react";
import { AppShell } from "./shell";
import { filterApi, type ContentFilter, type FilterTemplate } from "../lib/api";

// FiltersApp manages content-filter rules: a word is swapped before the request
// is sent to a provider (some providers block certain words) and restored in the
// reply. Named templates save/load whole sets of rules.
export function FiltersApp() {
  const [rows, setRows] = useState<ContentFilter[] | null>(null);
  const [pattern, setPattern] = useState("");
  const [replacement, setReplacement] = useState("");
  const [regex, setRegex] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [templates, setTemplates] = useState<FilterTemplate[]>([]);

  const load = () => filterApi.list().then((r) => setRows(r.filters ?? [])).catch(() => setRows([]));
  const loadTemplates = () => filterApi.templates().then((r) => setTemplates(r.templates ?? [])).catch(() => setTemplates([]));
  useEffect(() => { load(); loadTemplates(); }, []);

  const add = async () => {
    if (!pattern.trim()) { setErr("Enter a word/pattern to filter."); return; }
    setBusy(true); setErr("");
    try {
      await filterApi.add({ pattern: pattern.trim(), replacement: replacement.trim(), is_regex: regex, is_active: true });
      setPattern(""); setReplacement(""); setRegex(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally { setBusy(false); }
  };

  const toggle = async (f: ContentFilter) => {
    await filterApi.update(f.id, { pattern: f.pattern, replacement: f.replacement, is_regex: f.is_regex, is_active: !f.is_active });
    load();
  };
  const remove = async (id: number) => { await filterApi.remove(id); load(); };

  return (
    <AppShell title="Filters" subtitle="Swap blocked words before sending, restore them in the reply">
      {/* Templates + add — compact single row. */}
      <div className="mb-2 flex items-center gap-1.5">
        <input value={pattern} onChange={(e) => setPattern(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="word / pattern" className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white outline-none focus:border-white/25" />
        <ArrowRight className="h-3 w-3 shrink-0 text-white/25" />
        <input value={replacement} onChange={(e) => setReplacement(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="replacement" className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white outline-none focus:border-white/25" />
        <label className="flex shrink-0 items-center gap-1 text-[10px] text-white/45" title="Treat the pattern as a regular expression">
          <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} className="accent-indigo-500" />re
        </label>
        <button onClick={add} disabled={busy} title="Add rule" className="flex shrink-0 items-center rounded-md bg-white px-2 py-1.5 text-black hover:opacity-90 disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        </button>
        <TemplatesMenu templates={templates} rows={rows ?? []} onChange={() => { load(); loadTemplates(); }} />
      </div>
      {err && <div className="mb-2 text-[11px] text-red-300">{err}</div>}

      {/* Rules — dense list. */}
      {!rows ? (
        <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-white/40" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-center text-[11px] text-white/40">No filters yet.</div>
      ) : (
        <div className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/10">
          {rows.map((f) => (
            <div key={f.id} className={`flex items-center gap-2 px-2.5 py-1.5 ${f.is_active ? "" : "opacity-45"}`}>
              <code className="truncate font-mono text-[11px] text-white/85">{f.pattern}</code>
              <ArrowRight className="h-3 w-3 shrink-0 text-white/25" />
              <code className="truncate font-mono text-[11px] text-emerald-300">{f.replacement || "(removed)"}</code>
              {f.is_regex && <span className="shrink-0 rounded bg-white/10 px-1 text-[8px] uppercase text-white/45">re</span>}
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                <button onClick={() => toggle(f)} title={f.is_active ? "Disable" : "Enable"} className={`relative h-3.5 w-6 rounded-full transition-colors ${f.is_active ? "bg-emerald-500/80" : "bg-white/15"}`}>
                  <span className={`absolute top-0.5 left-0.5 h-2.5 w-2.5 rounded-full bg-white transition-transform ${f.is_active ? "translate-x-2.5" : ""}`} />
                </button>
                <button onClick={() => remove(f.id)} title="Delete" className="text-white/30 hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}

// TemplatesMenu saves the current set as a named template and loads/deletes saved ones.
function TemplatesMenu({ templates, rows, onChange }: { templates: FilterTemplate[]; rows: ContentFilter[]; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const save = async () => {
    if (!name.trim()) return;
    await filterApi.saveTemplate(name.trim());
    setName("");
    onChange();
  };
  const loadTpl = async (n: string) => { await filterApi.loadTemplate(n); setOpen(false); onChange(); };
  const del = async (n: string) => { await filterApi.removeTemplate(n); onChange(); };

  return (
    <div ref={ref} className="relative shrink-0">
      <button onClick={() => setOpen((v) => !v)} title="Templates" className="flex items-center gap-0.5 rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-1.5 text-[10px] text-white/60 hover:text-white">
        <BookmarkPlus className="h-3.5 w-3.5" /><ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-white/10 bg-[#0e1016] p-1.5 shadow-2xl">
          <div className="mb-1 flex items-center gap-1">
            <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="Save current as…" className="min-w-0 flex-1 rounded border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white outline-none focus:border-white/25" />
            <button onClick={save} disabled={!name.trim() || rows.length === 0} title="Save template" className="rounded bg-white/10 px-1.5 py-1 text-white/70 hover:bg-white/20 disabled:opacity-40"><BookmarkPlus className="h-3 w-3" /></button>
          </div>
          {templates.length === 0 ? (
            <div className="px-2 py-1.5 text-[10px] text-white/35">No templates saved.</div>
          ) : (
            <div className="max-h-56 space-y-0.5 overflow-auto">
              {templates.map((t) => (
                <div key={t.name} className="group flex items-center gap-1 rounded px-1.5 py-1 text-[11px] hover:bg-white/5">
                  <button onClick={() => loadTpl(t.name)} className="flex-1 truncate text-left text-white/80" title={`Load "${t.name}" (${t.rules.length} rules)`}>
                    {t.name} <span className="text-white/30">({t.rules.length})</span>
                  </button>
                  <button onClick={() => del(t.name)} title="Delete template" className="text-white/25 opacity-0 hover:text-red-300 group-hover:opacity-100"><Trash2 className="h-3 w-3" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
