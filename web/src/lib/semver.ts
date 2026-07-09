// compareVersions compares dot-separated numeric version strings ("1.2.3").
// Returns >0 if a is newer than b, <0 if older, 0 if equal. Non-numeric or
// missing segments compare as 0, so "1.2" and "1.2.0" are equal.
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
