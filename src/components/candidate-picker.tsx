"use client";

// Tier 4 confirm UI (CLAUDE-enhance.md §2 Tier 4): top-3 candidates with
// thumbnails, one-tap select, manual search as the always-available fallback.
// Never silently insert a low-confidence match.

import type { Database } from "@/types/database";

type Card = Database["public"]["Tables"]["cards"]["Row"];

export function CandidatePicker({
  candidates,
  onSelect,
  onSearchInstead,
  compact = false,
}: {
  candidates: Card[];
  onSelect: (card: Card) => void;
  onSearchInstead: () => void;
  compact?: boolean;
}) {
  return (
    <div className="space-y-2">
      {!compact && (
        <p className="text-text-secondary text-xs">
          Which card is this? Tap to confirm:
        </p>
      )}
      <div className="grid grid-cols-3 gap-2">
        {candidates.slice(0, 3).map((card) => (
          <button
            key={card.id}
            onClick={() => onSelect(card)}
            className="flex flex-col items-center gap-1.5 bg-bg-surface-2 rounded-xl p-2 border border-border-default hover:border-border-focus active:scale-[0.97] transition-all"
          >
            {card.image_small ? (
              <img
                src={card.image_small}
                alt={card.name}
                className="w-full aspect-63/88 rounded-lg object-cover bg-bg-surface"
              />
            ) : (
              <div className="w-full aspect-63/88 rounded-lg bg-bg-surface" />
            )}
            <div className="w-full min-w-0 text-center">
              <p className="text-text-primary text-[11px] font-medium truncate">
                {card.name}
              </p>
              <p className="text-text-muted text-[10px] truncate">
                {card.set_name}
                {card.number ? ` · ${card.number}` : ""}
              </p>
            </div>
          </button>
        ))}
      </div>
      <button
        onClick={onSearchInstead}
        className="w-full py-2.5 text-text-secondary text-xs font-medium rounded-xl border border-border-default hover:bg-bg-hover transition-colors"
      >
        None of these — search manually
      </button>
    </div>
  );
}
