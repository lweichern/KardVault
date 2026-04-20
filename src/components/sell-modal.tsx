"use client";

import { useState } from "react";
import type { InventoryItem } from "@/hooks/use-inventory";

interface SellModalProps {
  item: InventoryItem;
  onSell: (params: {
    inventoryId: string;
    cardId: string | null;
    salePriceMyr: number;
    condition: string;
    quantity: number;
  }) => Promise<void>;
  onClose: () => void;
}

export function SellModal({ item, onSell, onClose }: SellModalProps) {
  const cardName = item.card?.name ?? item.manual_card_name ?? "Unknown";
  const cardSetName = item.card?.set_name ?? item.manual_card_set ?? "";
  const cardImage = item.card?.image_small;

  // Default sale price from item.price_myr if set (convert from sen to RM)
  const defaultPrice = item.price_myr != null ? (item.price_myr / 100).toFixed(2) : "";
  const [salePrice, setSalePrice] = useState(defaultPrice);
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sold, setSold] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const price = parseFloat(salePrice);
    if (isNaN(price) || price <= 0) {
      setError("Enter a valid sale price");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onSell({
        inventoryId: item.id,
        cardId: item.card_id,
        salePriceMyr: Math.round(price * 100),
        condition: item.condition,
        quantity,
      });
      setSold(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record sale");
      setSaving(false);
    }
  }

  // Success state
  if (sold) {
    return (
      <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
        <div className="absolute inset-0 bg-black/60" onClick={onClose} />
        <div className="relative w-full max-w-md bg-bg-surface rounded-t-2xl sm:rounded-2xl p-5">
          <div className="text-center py-4">
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-success/15 mx-auto mb-4">
              <svg
                className="w-7 h-7 text-success"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m4.5 12.75 6 6 9-13.5"
                />
              </svg>
            </div>

            <h3 className="text-text-primary font-semibold text-lg mb-1">
              Sale recorded
            </h3>
            <p className="text-text-secondary text-sm mb-5">
              {quantity}× {cardName}
            </p>

            <button
              onClick={onClose}
              className="w-full h-12 bg-primary-400 text-text-on-primary text-sm font-medium rounded-xl"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-bg-surface rounded-t-2xl sm:rounded-2xl p-5">
        {/* Card preview */}
        <div className="flex items-center gap-3 mb-5">
          {cardImage ? (
            <img
              src={cardImage}
              alt={cardName}
              className="w-[56px] h-[78px] rounded-lg object-cover bg-bg-surface-2"
            />
          ) : (
            <div className="w-[56px] h-[78px] rounded-lg bg-bg-surface-2" />
          )}
          <div className="flex-1 min-w-0">
            <h3 className="text-text-primary font-semibold text-[15px] truncate">
              {cardName}
            </h3>
            {cardSetName && (
              <p className="text-text-secondary text-xs">
                {cardSetName} · {item.condition}
              </p>
            )}
            {!cardSetName && (
              <p className="text-text-secondary text-xs">{item.condition}</p>
            )}
            <p className="text-text-muted text-xs mt-0.5">
              {item.quantity} in stock
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Sale price */}
          <div>
            <label className="block text-text-secondary text-xs font-medium mb-1">
              Sale price (RM)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
              placeholder="Enter sale price"
              className="w-full h-11 bg-bg-surface-2 text-text-primary placeholder:text-text-muted rounded-xl px-3 text-sm border border-border-default focus:border-border-focus focus:outline-none"
              required
            />
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-text-secondary text-xs font-medium mb-1">
              Quantity sold
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="w-10 h-10 flex items-center justify-center rounded-lg bg-bg-surface-2 text-text-secondary border border-border-default"
              >
                −
              </button>
              <span className="text-text-primary text-lg font-medium w-8 text-center">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity(Math.min(item.quantity, quantity + 1))}
                className="w-10 h-10 flex items-center justify-center rounded-lg bg-bg-surface-2 text-text-secondary border border-border-default"
              >
                +
              </button>
            </div>
          </div>

          {error && (
            <p className="text-danger text-xs bg-danger/10 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-12 text-text-secondary text-sm font-medium rounded-xl border border-border-default hover:bg-bg-hover transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 h-12 bg-danger text-white text-sm font-medium rounded-xl disabled:opacity-50 transition-opacity"
            >
              {saving ? "Recording..." : `Sold (−${quantity})`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
