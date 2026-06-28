import { useEffect, useState } from "react";
import { Folder, FileText, ArrowUp, Home, X } from "lucide-react";
import { AppShell } from "./shell";
import { filesApi, type DirListing, type FileContent } from "../lib/api";

const fmtSize = (n: number) =>
  n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : n >= 1 << 10 ? `${(n / (1 << 10)).toFixed(1)} KB` : `${n} B`;

function join(dir: string, name: string) {
  return dir.endsWith("/") ? dir + name : dir + "/" + name;
}

export function FilesApp() {
  const [dir, setDir] = useState<DirListing | null>(null);
  const [path, setPath] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<FileContent | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    filesApi
      .list(path)
      .then((d) => {
        if (!alive) return;
        setDir(d);
        setError("");
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "failed to read"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path]);

  const openFile = async (full: string) => {
    try {
      setPreview(await filesApi.read(full));
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to read file");
    }
  };

  return (
    <AppShell title="Files" subtitle={dir?.path ?? "Local file browser"}>
      <div className="mb-3 flex items-center gap-1.5">
        <IconBtn onClick={() => setPath(dir?.home)} title="Home">
          <Home className="h-3.5 w-3.5" />
        </IconBtn>
        <IconBtn onClick={() => dir?.parent && setPath(dir.parent)} title="Up" disabled={!dir?.parent}>
          <ArrowUp className="h-3.5 w-3.5" />
        </IconBtn>
        <div className="ml-1 min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 font-mono text-[11px] text-white/60">
          {dir?.path ?? "…"}
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
      )}

      {loading ? (
        <div className="h-40 animate-pulse rounded-lg bg-white/5" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10">
          {dir?.entries.length === 0 ? (
            <div className="p-6 text-center text-xs text-white/40">Empty folder</div>
          ) : (
            <div className="max-h-[60vh] divide-y divide-white/5 overflow-auto">
              {dir?.entries.map((e) => {
                const full = join(dir.path, e.name);
                return (
                  <button
                    key={e.name}
                    onClick={() => (e.is_dir ? setPath(full) : openFile(full))}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors hover:bg-white/[0.04]"
                  >
                    {e.is_dir ? (
                      <Folder className="h-4 w-4 shrink-0 text-sky-300/80" />
                    ) : (
                      <FileText className="h-4 w-4 shrink-0 text-white/40" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-white/80">{e.name}</span>
                    {!e.is_dir && <span className="shrink-0 tabular-nums text-white/30">{fmtSize(e.size)}</span>}
                    <span className="hidden shrink-0 text-white/25 sm:inline">{e.mod}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {preview && <PreviewModal file={preview} onClose={() => setPreview(null)} />}
    </AppShell>
  );
}

function IconBtn({
  onClick,
  title,
  disabled,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function PreviewModal({ file, onClose }: { file: FileContent; onClose: () => void }) {
  const name = file.path.split("/").pop();
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[85%] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#11131a] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{name}</p>
            <p className="font-mono text-[10px] text-white/35">
              {fmtSize(file.size)}
              {file.truncated && " · preview truncated"}
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-black/30 p-3">
          {file.binary ? (
            <p className="text-center text-xs text-white/40">Binary file — preview unavailable.</p>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-white/80">
              {file.content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
