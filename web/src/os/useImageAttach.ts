import { useCallback, useState } from "react";
import { imageApi } from "../lib/api";

// useImageAttach manages a single pending image attachment: upload a File (from
// a picker, drag-drop, or clipboard paste) to the CDN and hold its URL until the
// message/post is sent, then clear it. Shared by chat + post composers.
export function useImageAttach() {
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const upload = useCallback(async (file?: File | null) => {
    if (!file || !file.type.startsWith("image/")) return;
    setError("");
    setUploading(true);
    try {
      const r = await imageApi.upload(file);
      setImageUrl(r.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setUploading(false);
    }
  }, []);

  // onPaste handler: grabs the first image in the clipboard.
  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
      if (item) {
        e.preventDefault();
        upload(item.getAsFile());
      }
    },
    [upload],
  );

  const clear = useCallback(() => {
    setImageUrl("");
    setError("");
  }, []);

  return { imageUrl, uploading, error, upload, onPaste, clear };
}
