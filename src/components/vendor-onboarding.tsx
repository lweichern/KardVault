"use client";

import { useState } from "react";

interface VendorOnboardingProps {
  onCreate: (params: {
    displayName: string;
    whatsappNumber: string;
  }) => Promise<unknown>;
}

export function VendorOnboarding({ onCreate }: VendorOnboardingProps) {
  const [displayName, setDisplayName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      await onCreate({
        displayName: displayName.trim(),
        whatsappNumber: whatsapp.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create profile");
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold mb-2">
            <span className="text-text-primary">Kad</span>
            <span className="text-primary-400">Vault</span>
          </h1>
          <p className="text-text-secondary text-sm">
            Set up your vendor profile to get started
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-text-secondary text-xs font-medium mb-1.5">
              Display name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your shop name"
              className="w-full h-12 bg-bg-surface-2 text-text-primary placeholder:text-text-muted rounded-xl px-4 text-sm border border-border-default focus:border-border-focus focus:outline-none"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-text-secondary text-xs font-medium mb-1.5">
              WhatsApp number
            </label>
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center h-12 px-3 bg-bg-surface-2 text-text-secondary text-sm rounded-xl border border-border-default">
                +60
              </span>
              <input
                type="tel"
                inputMode="numeric"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="12 345 6789"
                className="flex-1 h-12 bg-bg-surface-2 text-text-primary placeholder:text-text-muted rounded-xl px-4 text-sm border border-border-default focus:border-border-focus focus:outline-none"
                required
              />
            </div>
            <p className="text-text-muted text-[11px] mt-1.5">
              Buyers will contact you via WhatsApp
            </p>
          </div>

          {error && (
            <p className="text-danger text-xs bg-danger/10 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={saving || !displayName.trim() || !whatsapp.trim()}
            className="w-full h-12 bg-primary-400 text-text-on-primary font-medium text-sm rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {saving ? "Creating..." : "Create vendor profile"}
          </button>
        </form>
      </div>
    </div>
  );
}
