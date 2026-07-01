import { useEffect, useState } from "react";

// profileViewer is a tiny global store for "which user's profile page is open".
// Any component can call openProfile(userId) to show the full-page profile
// overlay (mounted once in Desktop). Set to null to close.
let current: string | null = null;
const listeners = new Set<() => void>();

export function openProfile(userId: string) {
  current = userId;
  listeners.forEach((l) => l());
}

export function closeProfile() {
  current = null;
  listeners.forEach((l) => l());
}

export function useProfileViewer(): string | null {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return current;
}
