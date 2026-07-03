import { useCallback, useState } from "react";
import { imageApi } from "../lib/api";

const MAX_IMAGES = 4;

// useImageAttach manages pending image attachments (up to MAX_IMAGES): upload
// Files (from a picker, drag-drop, or clipboard paste) to the CDN and hold their
// URLs until the message/post is sent, then clear. Shared by chat + posts.
export function useImageAttach(initial: string[] = []) {
  const [images, setImages] = useState<string[]>(initial);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const upload = useCallback(async (files?: FileList | File[] | File | null) => {
    if (!files) return;
    const list = (files instanceof File ? [files] : Array.from(files)).filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) return;
    setError("");
    setUploading(true);
    try {
      for (const file of list) {
        const r = await imageApi.upload(file);
        setImages((prev) => (prev.length >= MAX_IMAGES ? prev : [...prev, r.url]));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setUploading(false);
    }
  }, []);

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const imgs = Array.from(e.clipboardData.items)
        .filter((i) => i.type.startsWith("image/"))
        .map((i) => i.getAsFile())
        .filter((f): f is File => !!f);
      if (imgs.length) {
        e.preventDefault();
        upload(imgs);
      }
    },
    [upload],
  );

  const removeAt = useCallback((i: number) => setImages((prev) => prev.filter((_, j) => j !== i)), []);
  const clear = useCallback(() => {
    setImages([]);
    setError("");
  }, []);

  return { images, uploading, error, upload, onPaste, removeAt, clear, max: MAX_IMAGES };
}
