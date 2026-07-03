// Clipboard helpers that work across contexts. navigator.clipboard is only
// available in a secure context (HTTPS or localhost) — so when the dashboard is
// reached over a plain-HTTP reverse proxy it's undefined and copy silently
// fails. copyText falls back to a hidden textarea + execCommand("copy"), which
// works in insecure contexts too. (Programmatic paste/readText has no insecure
// fallback — browsers don't allow it — so remote paste needs HTTPS.)
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
