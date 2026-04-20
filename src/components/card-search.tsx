"use client";

import { useCardSearch } from "@/hooks/use-card-search";
import type { Database } from "@/types/database";

type Card = Database["public"]["Tables"]["cards"]["Row"];

interface CardSearchProps {
  onSelect: (card: Card) => void;
  placeholder?: string;
}

export function CardSearch({ onSelect, placeholder = "Search cards..." }: CardSearchProps) {
  const { query, results, searching, search, clear } = useCardSearch();

  function handleSelect(card: Card) {
    onSelect(card);
    clear();
  }

  return (
    <div className="relative">
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
          />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => search(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-bg-surface-2 text-text-primary placeholder:text-text-muted rounded-xl pl-10 pr-10 py-3 text-sm border border-border-default focus:border-border-focus focus:outline-none"
        />
        {query && (
          <button
            onClick={clear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Dropdown results */}
      {(results.length > 0 || (searching && query.length >= 2)) && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-bg-surface border border-border-default rounded-xl shadow-lg max-h-80 overflow-y-auto">
          {searching && results.length === 0 && (
            <div className="px-4 py-3 text-text-muted text-sm">Searching...</div>
          )}
          {!searching && results.length === 0 && query.length >= 2 && (
            <div className="px-4 py-3 text-text-muted text-sm">No cards found</div>
          )}
          {results.map((card) => (
            <button
              key={card.id}
              onClick={() => handleSelect(card)}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-bg-hover transition-colors text-left"
            >
              {card.image_small ? (
                <img
                  src={card.image_small}
                  alt={card.name}
                  className="w-[42px] h-[58px] rounded object-cover bg-bg-surface-2 flex-shrink-0"
                />
              ) : (
                <div className="w-[42px] h-[58px] rounded bg-bg-surface-2 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-text-primary text-sm font-medium truncate">
                  {card.name}
                </p>
                <p className="text-text-secondary text-xs truncate">
                  {card.set_name} · {card.number}
                </p>
                {card.rarity && (
                  <p className="text-text-muted text-[10px]">{card.rarity}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
