import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Check, Plus, X, Pencil, ImagePlus, Lock } from "lucide-react";
import { useProfile, refreshProfile } from "../os/useProfile";
import { profileApi, type ProfileLink } from "../lib/api";

// Field limits mirror the server (it re-validates; this is just nicer UX).
const MAX_DISPLAY = 32;
const MAX_PRONOUNS = 40;
const MAX_BIO = 190;
const MAX_LINKS = 5;

// ProfileEditor: a single-column edit form in a modal (avatar/banner upload,
// display name, pronouns, theme, bio, links). The server validates + sanitizes
// on save; changes show on the profile card after saving.
export function ProfileEditor() {
  const profile = useProfile();
  const u = profile.user;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Anchor the modal to the app content area (not the tiny banner slot it lives
  // in), so it covers the window like before instead of a full-screen overlay.
  const host = triggerRef.current?.closest("[data-app-content]") ?? null;
  const [displayName, setDisplayName] = useState(u?.display_name ?? "");
  const [pronouns, setPronouns] = useState(u?.pronouns ?? "");
  const [bio, setBio] = useState(u?.bio ?? "");
  // Default the swatches to a neutral grey so an untouched card stays grey;
  // picking real colors themes the card body (Primary→Accent gradient).
  const [primary, setPrimary] = useState(u?.primary_color || "#2b2d36");
  const [accent, setAccent] = useState(u?.accent_color || "#2b2d36");
  const [links, setLinks] = useState<ProfileLink[]>(u?.links ?? []);
  const [uploading, setUploading] = useState("");
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const canBanner = profile.has("profile.banner");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function pickAvatar(file?: File) {
    if (!file) return;
    setError("");
    setUploading("avatar");
    try {
      await profileApi.uploadAvatar(file);
      refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "avatar upload failed");
    } finally {
      setUploading("");
    }
  }
  async function pickBanner(file?: File) {
    if (!file) return;
    setError("");
    setUploading("banner");
    try {
      await profileApi.uploadBanner(file);
      refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "banner upload failed");
    } finally {
      setUploading("");
    }
  }

  if (!u) return null;

  function addLink() {
    if (links.length >= MAX_LINKS) return;
    setLinks([...links, { label: "", url: "" }]);
  }
  function setLink(i: number, patch: Partial<ProfileLink>) {
    setLinks(links.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }
  function removeLink(i: number) {
    setLinks(links.filter((_, j) => j !== i));
  }

  // Live preview merges the saved identity with the in-progress edits.

  async function save() {
    setError("");
    setBusy(true);
    try {
      await profile.saveProfile({
        display_name: displayName.trim(),
        pronouns: pronouns.trim(),
        bio: bio.trim(),
        primary_color: primary,
        accent_color: accent,
        links: links.filter((l) => l.url.trim()),
      });
      setDone(true);
      setTimeout(() => setDone(false), 1500);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "couldn't save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Glass pill: pencil icon that expands to "Edit" on hover. */}
      <button
        ref={triggerRef}
        onClick={() => setOpen(true)}
        title="Edit profile"
        className="group flex items-center rounded-full border border-white/15 bg-black/25 px-1.5 py-1.5 text-xs text-white/80 shadow-lg backdrop-blur-md transition-colors hover:bg-black/40 hover:text-white"
      >
        <Pencil className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 ease-out group-hover:ml-1 group-hover:max-w-[4rem] group-hover:pr-0.5">
          Edit
        </span>
      </button>

      {open && host && createPortal(
        <div
          className="absolute inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0e1016] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
              <p className="text-sm font-semibold text-white">Edit profile</p>
              <button onClick={() => !busy && setOpen(false)} className="rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 overflow-hidden">
              {/* Form */}
              <div className="w-full space-y-4 overflow-auto px-4 py-4">
                {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

                <Field label="Avatar & banner">
                  <div className="flex items-center gap-2">
                    <input ref={avatarInput} type="file" accept="image/*" hidden onChange={(e) => pickAvatar(e.target.files?.[0])} />
                    <input ref={bannerInput} type="file" accept="image/*" hidden onChange={(e) => pickBanner(e.target.files?.[0])} />
                    <button
                      onClick={() => avatarInput.current?.click()}
                      disabled={!!uploading}
                      className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/5 disabled:opacity-50"
                    >
                      {uploading === "avatar" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                      Avatar
                    </button>
                    <button
                      onClick={() => canBanner && bannerInput.current?.click()}
                      disabled={!!uploading || !canBanner}
                      title={canBanner ? "" : "Wear the [enow] tag to unlock banners"}
                      className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/5 disabled:opacity-50"
                    >
                      {uploading === "banner" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : canBanner ? <ImagePlus className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                      Banner
                    </button>
                  </div>
                  {!canBanner && <p className="mt-1 text-[10px] text-white/35">Banner is a tag-gated perk (wear the [enow] server tag).</p>}
                </Field>

                <Field label="Display name" hint={`${displayName.length}/${MAX_DISPLAY}`}>
                  <input
                    value={displayName}
                    maxLength={MAX_DISPLAY}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={u.username}
                    className={inputCls}
                  />
                </Field>

                <Field label="Pronouns" hint={`${pronouns.length}/${MAX_PRONOUNS}`}>
                  <input
                    value={pronouns}
                    maxLength={MAX_PRONOUNS}
                    onChange={(e) => setPronouns(e.target.value)}
                    placeholder="e.g. they/them"
                    className={inputCls}
                  />
                </Field>

                <Field label="Profile theme">
                  <div className="flex gap-4">
                    <Swatch label="Primary" value={primary} onChange={setPrimary} />
                    <Swatch label="Accent" value={accent} onChange={setAccent} />
                  </div>
                </Field>

                <Field label="Bio" hint={`${bio.length}/${MAX_BIO}`}>
                  <textarea
                    value={bio}
                    maxLength={MAX_BIO}
                    rows={3}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="A short line about you"
                    className={`${inputCls} resize-none`}
                  />
                </Field>

                <Field label="Links" hint={`${links.length}/${MAX_LINKS}`}>
                  <div className="space-y-2">
                    {links.map((l, i) => (
                      <div key={i} className="rounded-lg border border-white/10 bg-black/20 p-2">
                        <div className="mb-1.5 flex items-center gap-1.5">
                          <input
                            value={l.label}
                            onChange={(e) => setLink(i, { label: e.target.value })}
                            placeholder="Label (e.g. GitHub)"
                            className={`${inputCls} flex-1 border-white/5 bg-black/30`}
                          />
                          <button onClick={() => removeLink(i)} className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <input
                          value={l.url}
                          onChange={(e) => setLink(i, { url: e.target.value })}
                          placeholder="https://…"
                          className={`${inputCls} border-white/5 bg-black/30`}
                        />
                      </div>
                    ))}
                    {links.length < MAX_LINKS && (
                      <button onClick={addLink} className="flex items-center gap-1 text-[11px] text-white/50 hover:text-white">
                        <Plus className="h-3 w-3" /> Add link
                      </button>
                    )}
                  </div>
                </Field>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-white/5 px-4 py-3">
              <button onClick={() => setOpen(false)} disabled={busy} className="rounded-lg px-3 py-1.5 text-xs text-white/50 hover:text-white disabled:opacity-50">
                Cancel
              </button>
              <button
                onClick={save}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-500/90 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : done ? <Check className="h-3.5 w-3.5" /> : null}
                Save changes
              </button>
            </div>
          </div>
        </div>,
        host,
      )}
    </>
  );
}

const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs text-white outline-none focus:border-white/25";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-medium text-white/50">{label}</span>
        {hint && <span className="text-[10px] text-white/30">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Swatch({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex cursor-pointer flex-col items-center gap-1">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-12 cursor-pointer rounded-lg border border-white/10 bg-transparent"
      />
      <span className="text-[10px] text-white/40">{label}</span>
    </label>
  );
}
