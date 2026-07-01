import { openLightbox } from "../os/lightbox";

// ImageGrid renders small message/post image thumbnails; clicking opens the
// lightbox at that image. Layout adapts to 1–4 images.
export function ImageGrid({ images, size = "sm" }: { images: string[]; size?: "sm" | "md" }) {
  if (!images || images.length === 0) return null;
  const cell = size === "md" ? "h-32 w-32" : "h-24 w-24";
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {images.map((url, i) => (
        <button
          key={i}
          onClick={() => openLightbox(images, i)}
          className={`${cell} overflow-hidden rounded-lg border border-white/10 hover:border-white/25`}
        >
          <img src={url} alt="" className="h-full w-full object-cover" />
        </button>
      ))}
    </div>
  );
}
