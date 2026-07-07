import { useState } from "react";
import { X } from "lucide-react";
import { ProviderIcon } from "./ProviderIcon";
import { accountsApi, type NewAccount, type Provider } from "../lib/api";
import { formFor } from "../lib/providerFields";

export function AddAccountModal({
  provider,
  onClose,
  onSaved,
}: {
  provider: Provider;
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = formFor(provider.name);
  const [label, setLabel] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function set(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  async function submit() {
    setError("");
    for (const f of form.fields) {
      if (f.required && !values[f.key]?.trim()) {
        setError(`${f.label} is required`);
        return;
      }
    }
    const payload: NewAccount = { provider: provider.name, label: label.trim() || undefined };
    if (form.single) {
      payload.secret = values[form.fields[0].key]?.trim();
    } else {
      const creds: Record<string, string> = {};
      for (const f of form.fields) {
        const v = values[f.key]?.trim();
        if (v) creds[f.key] = v;
      }
      payload.creds = creds;
    }
    setSaving(true);
    try {
      await accountsApi.add(payload);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#11131a] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-white/5 px-4 py-3">
          <ProviderIcon icon={provider.icon} label={provider.label} size={32} />
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">Add {provider.label} account</p>
            <p className="text-[11px] text-white/40">Credentials are stored locally.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] space-y-3 overflow-auto px-4 py-4">
          <Field label="Label (optional)">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. personal key"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/25 focus:outline-none"
            />
          </Field>

          {form.fields.map((f) => (
            <Field key={f.key} label={f.label + (f.required ? " *" : "")}>
              <input
                type={f.secret ? "password" : "text"}
                value={values[f.key] ?? ""}
                onChange={(e) => set(f.key, e.target.value)}
                placeholder={f.placeholder}
                autoComplete="off"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/25 focus:outline-none"
              />
            </Field>
          ))}

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-white/5 px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-white/60 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="rounded-lg bg-white px-4 py-1.5 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Add account"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-white/50">{label}</span>
      {children}
    </label>
  );
}
