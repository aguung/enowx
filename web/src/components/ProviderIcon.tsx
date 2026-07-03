import { useState } from "react";

const exts = ["webp", "png"] as const;

// ProviderIcon renders /providers/<icon>.webp, falling back to .png, then to a
// letter badge when no asset exists (e.g. openai).
export function ProviderIcon({ icon, label, size = 40 }: { icon: string; label: string; size?: number }) {
  const [step, setStep] = useState(0);

  if (step >= exts.length) {
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
      onError={() => setStep((s) => s + 1)}
      className="rounded-xl object-contain"
      style={{ width: size, height: size, imageRendering: "auto" }}
    />
  );
}
