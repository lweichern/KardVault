"use client";

// TCGplayer market prices for a set of catalog cards, converted to MYR.
// Data: tcg_products (mapped via card_id) → tcg_prices, synced daily by
// scripts/sync-tcgcsv.ts. A card can map to several TCGplayer printings
// (Unlimited/Shadowless/promo) — we surface the LOWEST non-null market
// price, which corresponds to the most common printing.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

export interface MarketPrice {
  usd: number;
  myr: number;
}

const FALLBACK_USD_MYR = 4.5;
const RATE_CACHE_KEY = "kv_usd_myr_rate";
const RATE_TTL_MS = 24 * 60 * 60 * 1000;
const CHUNK = 100;

async function getUsdMyrRate(): Promise<number> {
  try {
    const cached = localStorage.getItem(RATE_CACHE_KEY);
    if (cached) {
      const { rate, at } = JSON.parse(cached) as { rate: number; at: number };
      if (Date.now() - at < RATE_TTL_MS && rate > 0) return rate;
    }
  } catch {
    // ignore bad cache
  }
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as { rates?: { MYR?: number } };
    const rate = data.rates?.MYR;
    if (rate && rate > 0) {
      localStorage.setItem(RATE_CACHE_KEY, JSON.stringify({ rate, at: Date.now() }));
      return rate;
    }
  } catch {
    // offline / blocked — fall back
  }
  return FALLBACK_USD_MYR;
}

export function useMarketPrices(cardIds: Array<string | null | undefined>) {
  const [prices, setPrices] = useState<Record<string, MarketPrice>>({});
  const [rate, setRate] = useState<number>(FALLBACK_USD_MYR);
  const supabase = createClient();

  // Stable key so the effect only refires when the actual id set changes
  const idsKey = [...new Set(cardIds.filter((id): id is string => !!id))].sort().join(",");

  useEffect(() => {
    if (!idsKey) {
      setPrices({});
      return;
    }
    let cancelled = false;

    (async () => {
      const myrRate = await getUsdMyrRate();
      const ids = idsKey.split(",");
      const best = new Map<string, number>();

      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const { data } = await supabase
          .from("tcg_products")
          .select("card_id, tcg_prices(market_price)")
          .in("card_id", chunk);
        for (const row of data ?? []) {
          if (!row.card_id) continue;
          for (const p of row.tcg_prices ?? []) {
            if (p.market_price == null) continue;
            const current = best.get(row.card_id);
            if (current === undefined || p.market_price < current) {
              best.set(row.card_id, p.market_price);
            }
          }
        }
      }

      if (cancelled) return;
      const result: Record<string, MarketPrice> = {};
      for (const [cardId, usd] of best) {
        result[cardId] = { usd, myr: usd * myrRate };
      }
      setRate(myrRate);
      setPrices(result);
    })();

    return () => {
      cancelled = true;
    };
  }, [idsKey, supabase]);

  return { prices, rate };
}
