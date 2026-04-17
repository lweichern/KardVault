"use client";

import { useEffect, useState, useMemo } from "react";
import QRCode from "qrcode";
import { useAuth } from "@/hooks/use-auth";
import { useVendor } from "@/hooks/use-vendor";
import { useInventory } from "@/hooks/use-inventory";

export default function StorefrontPage() {
  const { user } = useAuth();
  const { vendor, loading: vendorLoading } = useVendor(user?.id);
  const { items, totalCards, loading: inventoryLoading } = useInventory(vendor?.id);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const storefrontUrl = vendor
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/v/${vendor.slug}`
    : "";

  const setCount = useMemo(() => {
    const sets = new Set(items.map((i) => i.card.set_name));
    return sets.size;
  }, [items]);

  useEffect(() => {
    if (!vendor) return;

    const url = `${window.location.origin}/v/${vendor.slug}`;
    QRCode.toDataURL(url, {
      width: 200,
      margin: 2,
      color: { dark: "#1A1825", light: "#FFFFFF" },
    }).then(setQrDataUrl);
  }, [vendor]);

  async function handleCopyLink() {
    await navigator.clipboard.writeText(storefrontUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleOpenStorefront() {
    window.open(storefrontUrl, "_blank");
  }

  const loading = vendorLoading || inventoryLoading;

  if (loading) {
    return (
      <div className="px-4 pt-6">
        <header className="mb-6">
          <h1 className="text-xl font-bold">
            <span className="text-text-primary">Kard</span>
            <span className="text-primary-400">Vault</span>
          </h1>
          <p className="text-text-secondary text-sm mt-1">Your Storefront</p>
        </header>
        <div className="flex items-center justify-center py-20">
          <p className="text-text-muted text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!vendor) {
    return (
      <div className="px-4 pt-6">
        <p className="text-text-muted text-sm">Sign in to view your storefront.</p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-6">
      <header className="mb-6">
        <h1 className="text-xl font-bold">
          <span className="text-text-primary">Kard</span>
          <span className="text-primary-400">Vault</span>
        </h1>
        <p className="text-text-secondary text-sm mt-1">Your Storefront</p>
      </header>

      {/* QR Code card */}
      <div className="bg-bg-surface rounded-xl p-6 text-center mb-4">
        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt="Storefront QR Code"
            className="w-[200px] h-[200px] mx-auto rounded-lg mb-3"
          />
        ) : (
          <div className="w-[200px] h-[200px] mx-auto rounded-lg bg-bg-surface-2 mb-3 flex items-center justify-center">
            <p className="text-text-muted text-xs">Generating...</p>
          </div>
        )}
        <p className="text-text-secondary text-xs">
          {storefrontUrl.replace(/^https?:\/\//, "")}
        </p>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <button
          onClick={handleCopyLink}
          className="flex items-center justify-center gap-2 h-11 bg-bg-surface text-text-primary text-sm font-medium rounded-xl border border-border-default hover:bg-bg-hover transition-colors"
        >
          {copied ? (
            <>
              <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
              </svg>
              Copy Link
            </>
          )}
        </button>
        <button
          onClick={handleOpenStorefront}
          className="flex items-center justify-center gap-2 h-11 bg-primary-400 text-text-on-primary text-sm font-medium rounded-xl transition-opacity hover:opacity-90"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
          Open Storefront
        </button>
      </div>

      {/* Stats card */}
      <div className="bg-bg-surface rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          {totalCards > 0 ? (
            <div className="w-2 h-2 rounded-full bg-success" />
          ) : (
            <div className="w-2 h-2 rounded-full bg-text-muted" />
          )}
          <p className="text-text-secondary text-xs font-medium">
            {totalCards > 0 ? "Your storefront is live" : "No cards listed"}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-text-muted text-[10px] uppercase tracking-wide">Cards listed</p>
            <p className="text-text-primary text-lg font-bold">{totalCards}</p>
          </div>
          <div>
            <p className="text-text-muted text-[10px] uppercase tracking-wide">Sets</p>
            <p className="text-text-primary text-lg font-bold">{setCount}</p>
          </div>
        </div>

        {totalCards === 0 && (
          <p className="text-text-muted text-xs mt-3">
            Add cards to your inventory so buyers have something to browse.
          </p>
        )}
      </div>
    </div>
  );
}
