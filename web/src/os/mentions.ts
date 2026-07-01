// mentionsMe reports whether a chat/comment body @-mentions the current user,
// by username or display name (case-insensitive). Used to highlight messages
// that ping you (Discord-style). Display names with spaces are matched as a
// whole word right after the @.
export function mentionsMe(text: string, username?: string, displayName?: string): boolean {
  if (!text) return false;
  const names = [username, displayName].filter((n): n is string => !!n && n.trim().length > 0);
  const lower = text.toLowerCase();
  for (const n of names) {
    const at = "@" + n.toLowerCase();
    let i = lower.indexOf(at);
    while (i !== -1) {
      // The char after the match must be a boundary (not a name char), so
      // "@john" doesn't match "@johnny".
      const after = lower[i + at.length];
      if (after === undefined || !/[a-z0-9_.]/i.test(after)) return true;
      i = lower.indexOf(at, i + 1);
    }
  }
  return false;
}
