"use client";

import { useState } from "react";
import { GradingSelector, type GradingCompany } from "@/components/grading-selector";
import type { Database } from "@/types/database";

type Card = Database["public"]["Tables"]["cards"]["Row"];
type Condition = Database["public"]["Tables"]["inventory"]["Row"]["condition"];

const CONDITIONS: Condition[] = ["NM", "LP", "MP", "HP", "DMG"];

interface AddCardModalProps {
  card: Card;
  onAdd: (params: {
    cardId: string;
    sellPriceRm: number;
    buyPriceRm?: number;
    condition: Condition;
    quantity: number;
    gradingCompany?: string;
    grade?: string;
  }) => Promise<void>;
  onClose: () => void;
}

export function AddCardModal({ card, onAdd, onClose }: AddCardModalProps) {
  const defaultPrice = card.market_price_rm ?? 0;
  const [sellPrice, setSellPrice] = useState(defaultPrice.toFixed(2));
  const [buyPrice, setBuyPrice] = useState("");
  const [condition, setCondition] = useState<Condition>("NM");
  const [quantity, setQuantity] = useState(1);
  const [isGraded, setIsGraded] = useState(false);
  const [gradingCompany, setGradingCompany] = useState<GradingCompany | null>(null);
  const [grade, setGrade] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sell = parseFloat(sellPrice);
    if (isNaN(sell) || sell <= 0) {
      setError("Enter a valid sell price");
      return;
    }
    if (isGraded && (!gradingCompany || !grade)) {
      setError("Select a grading company and grade");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onAdd({
        cardId: card.id,
        sellPriceRm: sell,
        buyPriceRm: buyPrice ? parseFloat(buyPrice) : undefined,
        condition,
        quantity,
        gradingCompany: isGraded ? gradingCompany ?? undefined : undefined,
        grade: isGraded ? grade || undefined : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add card");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-bg-surface rounded-t-2xl sm:rounded-2xl p-5 max-h-[90dvh] overflow-y-auto">
        {/* Card preview */}
        <div className="flex items-center gap-3 mb-5">
          {card.image_small ? (
            <img
              src={card.image_small}
              alt={card.name}
              className="w-[70px] h-[98px] rounded-lg object-cover bg-bg-surface-2"
            />
          ) : (
            <div className="w-[70px] h-[98px] rounded-lg bg-bg-surface-2" />
          )}
          <div className="flex-1 min-w-0">
            <h3 className="text-text-primary font-semibold text-[15px] truncate">
              {card.name}
            </h3>
            <p className="text-text-secondary text-xs">
              {card.set_name} · {card.card_number}
            </p>
            {card.market_price_rm != null && (
              <p className="text-primary-200 text-sm font-medium mt-1">
                Market: RM {card.market_price_rm.toFixed(2)}
              </p>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Price inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-text-secondary text-xs font-medium mb-1">
                Your price (RM)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value)}
                className="w-full h-11 bg-bg-surface-2 text-text-primary rounded-xl px-3 text-sm border border-border-default focus:border-border-focus focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-text-secondary text-xs font-medium mb-1">
                Buy price (RM)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={buyPrice}
                onChange={(e) => setBuyPrice(e.target.value)}
                placeholder="Optional"
                className="w-full h-11 bg-bg-surface-2 text-text-primary placeholder:text-text-muted rounded-xl px-3 text-sm border border-border-default focus:border-border-focus focus:outline-none"
              />
            </div>
          </div>

          {/* Grading */}
          <GradingSelector
            isGraded={isGraded}
            onToggleGraded={setIsGraded}
            company={gradingCompany}
            onCompanyChange={setGradingCompany}
            grade={grade}
            onGradeChange={setGrade}
          />

          {/* Condition — only for raw cards */}
          {!isGraded && (
            <div>
              <label className="block text-text-secondary text-xs font-medium mb-1.5">
                Condition
              </label>
              <div className="flex gap-2">
                {CONDITIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCondition(c)}
                    className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${
                      condition === c
                        ? "bg-primary-400 text-text-on-primary border-primary-400"
                        : "bg-bg-surface-2 text-text-secondary border-border-default hover:border-border-hover"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quantity */}
          <div>
            <label className="block text-text-secondary text-xs font-medium mb-1">
              Quantity
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="w-10 h-10 flex items-center justify-center rounded-lg bg-bg-surface-2 text-text-secondary border border-border-default hover:border-border-hover"
              >
                −
              </button>
              <span className="text-text-primary text-lg font-medium w-8 text-center">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity(quantity + 1)}
                className="w-10 h-10 flex items-center justify-center rounded-lg bg-bg-surface-2 text-text-secondary border border-border-default hover:border-border-hover"
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

          {/* Actions */}
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
              className="flex-1 h-12 bg-primary-400 text-text-on-primary text-sm font-medium rounded-xl disabled:opacity-50 transition-opacity"
            >
              {saving ? "Adding..." : "Add to inventory"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
