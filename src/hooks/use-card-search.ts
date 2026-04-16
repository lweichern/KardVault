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
        // Use ilike for prefix/contains matching — fast with the trigram GIN index
        const { data, error } = await supabase
          .from("cards")
          .select("*")
          .or(`name.ilike.%${q.trim()}%,card_number.ilike.%${q.trim()}%`)
          .order("name")
          .limit(20);

        if (!error && data) {
          setResults(data);
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
