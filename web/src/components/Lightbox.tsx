import { useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { useLightbox, closeLightbox, stepLightbox } from "../os/lightbox";

// Lightbox is the full-screen image viewer overlay (zoom + prev/next + esc/
// click-away). Mounted once in Desktop; driven by the lightbox store.
export function Lightbox() {
  const lb = useLightbox();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  // Reset zoom/pan when the image changes.
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [lb?.index]);

  useEffect(() => {
    if (!lb) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowRight") stepLightbox(1);
      if (e.key === "ArrowLeft") stepLightbox(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lb]);

  if (!lb) return null;
  const src = lb.images[lb.index];
  const multi = lb.images.length > 1;

  return (
    <div className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/85 backdrop-blur-sm" onClick={closeLightbox}>
      {/* Controls */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => setZoom((z) => Math.max(1, z - 0.5))} className="rounded-lg bg-white/10 p-2 text-white/80 hover:bg-white/20"><ZoomOut className="h-4 w-4" /></button>
        <button onClick={() => setZoom((z) => Math.min(5, z + 0.5))} className="rounded-lg bg-white/10 p-2 text-white/80 hover:bg-white/20"><ZoomIn className="h-4 w-4" /></button>
        <button onClick={closeLightbox} className="rounded-lg bg-white/10 p-2 text-white/80 hover:bg-white/20"><X className="h-4 w-4" /></button>
      </div>
      {multi && lb.index > 0 && (
        <button onClick={(e) => { e.stopPropagation(); stepLightbox(-1); }} className="absolute left-3 z-10 rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20"><ChevronLeft className="h-6 w-6" /></button>
      )}
      {multi && (
        <button onClick={(e) => { e.stopPropagation(); stepLightbox(1); }} className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20"><ChevronRight className="h-6 w-6" /></button>
      )}

      <img
        src={src}
        alt=""
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => setZoom((z) => Math.min(5, Math.max(1, z - e.deltaY * 0.002)))}
        onMouseDown={(e) => { if (zoom > 1) drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }; }}
        onMouseMove={(e) => { if (drag.current) setPan({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }); }}
        onMouseUp={() => (drag.current = null)}
        onMouseLeave={() => (drag.current = null)}
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, cursor: zoom > 1 ? "grab" : "default" }}
        className="max-h-[90vh] max-w-[92vw] select-none rounded-lg object-contain transition-transform"
        draggable={false}
      />

      {multi && (
        <div className="absolute bottom-3 z-10 rounded-full bg-black/50 px-2.5 py-0.5 text-[11px] text-white/70">
          {lb.index + 1} / {lb.images.length}
        </div>
      )}
    </div>
  );
}
