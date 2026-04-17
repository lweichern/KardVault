"use client";

import { useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase";

export function useStorefrontAnalytics(vendorId: string) {
  const supabase = createClient();
  const viewedCards = useRef(new Set<string>());
  const loggedSearches = useRef(new Set<string>());

  const logCardView = useCallback(
    (cardId: string) => {
      if (viewedCards.current.has(cardId)) return;
      viewedCards.current.add(cardId);
      (supabase as any)
        .from("storefront_views")
        .insert({ vendor_id: vendorId, card_id: cardId })
        .then(() => {});
    },
    [vendorId, supabase]
  );

  const logSearch = useCallback(
    (query: string, resultsCount: number) => {
      const normalized = query.toLowerCase().trim();
      if (normalized.length < 2 || loggedSearches.current.has(normalized))
        return;
      loggedSearches.current.add(normalized);
      (supabase as any)
        .from("storefront_searches")
        .insert({
          vendor_id: vendorId,
          query: normalized,
          results_count: resultsCount,
        })
        .then(() => {});
    },
    [vendorId, supabase]
  );

  return { logCardView, logSearch };
}
