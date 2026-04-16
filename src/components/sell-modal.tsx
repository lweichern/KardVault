"use client";

import { useState } from "react";
import type { InventoryItem } from "@/hooks/use-inventory";

interface SellModalProps {
  item: InventoryItem;
  onSell: (params: {
    inventoryId: string;
    cardId: string;
    salePriceRm: number;
    condition: string;
    quantity: number;
  }) => Promise<void>;
  onClose: () => void;
}

interface SaleResult {
  totalRevenue: number;
  totalProfit: number | null;
  quantity: number;
}

export function SellModal({ item, onSell, onClose }: SellModalProps) {
  const [salePrice, setSalePrice] = useState(item.sell_price_rm.toFixed(2));
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SaleResult | null>(null);

  const profitPerCard =
    item.buy_price_rm != null
      ? (parseFloat(salePrice) || 0) - item.buy_price_rm
      : null;

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
        salePriceRm: price,
        condition: item.condition,
        quantity,
      });

      const totalRevenue = price * quantity;
      const totalProfit =
        item.buy_price_rm != null
          ? (price - item.buy_price_rm) * quantity
          : null;

      setResult({ totalRevenue, totalProfit, quantity });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record sale");
      setSaving(false);
    }
  }

  // Success state
  if (result) {
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
              {result.quantity}× {item.card.name}
            </p>

            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="bg-bg-surface-2 rounded-xl p-3">
                <p className="text-text-muted text-[10px] uppercase tracking-wide mb-0.5">
                  Revenue
                </p>
                <p className="text-text-primary text-lg font-bold">
                  RM {result.totalRevenue.toFixed(2)}
                </p>
              </div>
              <div className="bg-bg-surface-2 rounded-xl p-3">
                <p className="text-text-muted text-[10px] uppercase tracking-wide mb-0.5">
                  Profit
                </p>
                {result.totalProfit != null ? (
                  <p
                    className={`text-lg font-bold ${
                      result.totalProfit >= 0 ? "text-success" : "text-danger"
                    }`}
                  >
                    {result.totalProfit >= 0 ? "+" : ""}RM{" "}
                    {result.totalProfit.toFixed(2)}
                  </p>
                ) : (
                  <p className="text-text-muted text-lg font-bold">—</p>
                )}
              </div>
            </div>

            {result.totalProfit == null && (
              <p className="text-text-muted text-[11px] mb-4">
                No buy price recorded — set one when adding cards to track profit
              </p>
            )}

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
          {item.card.image_small ? (
            <img
              src={item.card.image_small}
              alt={item.card.name}
              className="w-[56px] h-[78px] rounded-lg object-cover bg-bg-surface-2"
            />
          ) : (
            <div className="w-[56px] h-[78px] rounded-lg bg-bg-surface-2" />
          )}
          <div className="flex-1 min-w-0">
            <h3 className="text-text-primary font-semibold text-[15px] truncate">
              {item.card.name}
            </h3>
            <p className="text-text-secondary text-xs">
              {item.card.set_name} · {item.condition}
            </p>
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
              className="w-full h-11 bg-bg-surface-2 text-text-primary rounded-xl px-3 text-sm border border-border-default focus:border-border-focus focus:outline-none"
              required
            />
            {profitPerCard != null && (
              <p
                className={`text-xs mt-1 ${
                  profitPerCard >= 0 ? "text-success" : "text-danger"
                }`}
              >
                {profitPerCard >= 0 ? "+" : ""}RM {profitPerCard.toFixed(2)} est.
                profit per card
                {quantity > 1 && (
                  <span className="text-text-muted">
                    {" "}
                    · RM {(profitPerCard * quantity).toFixed(2)} total
                  </span>
                )}
              </p>
            )}
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
