import { openLightbox } from "../os/lightbox";

// ImageGrid renders small message/post image thumbnails; clicking opens the
// lightbox at that image. Thumbnails keep their aspect ratio (bounded height,
// natural width) so they are only scaled down, never cropped.
export function ImageGrid({ images, size = "sm" }: { images: string[]; size?: "sm" | "md" }) {
  if (!images || images.length === 0) return null;
  const maxH = size === "md" ? "max-h-64" : "max-h-48";
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {images.map((url, i) => (
        <button
          key={i}
          onClick={() => openLightbox(images, i)}
          className="overflow-hidden rounded-lg border border-white/10 hover:border-white/25"
        >
          <img src={url} alt="" className={`${maxH} w-auto max-w-full object-contain`} />
        </button>
      ))}
    </div>
  );
}
