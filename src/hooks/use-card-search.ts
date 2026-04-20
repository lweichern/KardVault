"use client";

import { useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import type { Database } from "@/types/database";

type Card = Database["public"]["Tables"]["cards"]["Row"];

export function useCardSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Card[]>([]);
  const [searching, setSearching] = useState(false);
  const supabase = createClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const search = useCallback(
    (q: string) => {
      setQuery(q);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (q.trim().length < 2) {
        setResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      debounceRef.current = setTimeout(async () => {
        const { data, error } = await supabase.rpc("search_cards", {
          search_query: q.trim(),
          result_limit: 20,
          result_offset: 0,
        });
        if (!error && data) {
          setResults(data as Card[]);
        }
        setSearching(false);
      }, 250);
    },
    [supabase]
  );

  function clear() {
    setQuery("");
    setResults([]);
    setSearching(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }

  return { query, results, searching, search, clear };
}
