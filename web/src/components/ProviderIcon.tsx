import { useState } from "react";

const exts = ["webp", "png"] as const;

// resolved remembers which step (extension index, or `exts.length` for the
// letter fallback) worked for each icon name, module-wide. Rows recycle as you
// scroll, so without this every re-mount would re-try .webp then .png again —
// re-requesting (and re-404ing, for providers with no asset) on every scroll.
const resolved: Record<string, number> = {};

// ProviderIcon renders /providers/<icon>.webp, falling back to .png, then to a
// letter badge when no asset exists (e.g. openai). The working step is cached so
// it resolves instantly on subsequent renders.
export function ProviderIcon({ icon, label, size = 40 }: { icon: string; label: string; size?: number }) {
  const [step, setStep] = useState(resolved[icon] ?? 0);

  if (step >= exts.length) {
    resolved[icon] = exts.length;
    return (
      <div
        className="flex items-center justify-center rounded-xl bg-gradient-to-br from-white/15 to-white/5 font-bold text-white/80"
        style={{ width: size, height: size, fontSize: size * 0.42 }}
      >
        {label.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={`/providers/${icon}.${exts[step]}`}
      alt=""
      loading="lazy"
      decoding="async"
      onLoad={() => { resolved[icon] = step; }}
      onError={() => setStep((s) => s + 1)}
      className="rounded-xl object-contain"
      style={{ width: size, height: size, imageRendering: "auto" }}
    />
  );
}
