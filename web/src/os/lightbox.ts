import { useEffect, useState } from "react";

// lightbox is a tiny global store for the image lightbox overlay: open it with a
// set of image URLs + a starting index. Mounted once in Desktop.
interface LBState {
  images: string[];
  index: number;
}
let state: LBState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openLightbox(images: string[], index = 0) {
  state = { images, index };
  emit();
}
export function closeLightbox() {
  state = null;
  emit();
}
export function stepLightbox(delta: number) {
  if (!state) return;
  const n = state.images.length;
  state = { ...state, index: (state.index + delta + n) % n };
  emit();
}

export function useLightbox(): LBState | null {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return state;
}
