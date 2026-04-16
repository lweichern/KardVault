/**
 * Card sync engine — shared between the standalone script and API route.
 *
 * 1. Fetches cards from pokemontcg.io (full or incremental)
 * 2. Converts USD prices to MYR
 * 3. Upserts into Supabase `cards` table in batches
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  fetchAllCards,
  fetchCardsSince,
  extractMarketPrice,
  type PokemonTcgCard,
} from "./pokemontcg";

// Fallback USD→MYR rate. Updated manually or via exchange rate API.
const DEFAULT_USD_TO_MYR = 4.45;
const UPSERT_BATCH_SIZE = 500;

export interface SyncOptions {
  /** pokemontcg.io API key (optional, increases rate limit) */
  apiKey?: string;
  /** Only sync cards updated since this date */
  since?: Date;
  /** USD to MYR exchange rate (defaults to 4.45) */
  usdToMyr?: number;
  /** Progress callback */
  onProgress?: (message: string) => void;
}

export interface SyncResult {
  totalFetched: number;
  totalUpserted: number;
  durationMs: number;
  errors: string[];
}

/**
 * Create a Supabase admin client using the service role key.
 * This bypasses RLS — needed because the `cards` table has no INSERT policy
 * for regular users (it's reference data managed by cron).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAdminClient(): SupabaseClient<any> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  // Untyped client — the service role bypasses RLS, but the Database type
  // doesn't include INSERT on cards (no RLS INSERT policy for regular users).
  return createClient(url, key);
}

function toCardRow(card: PokemonTcgCard, usdToMyr: number) {
  const priceUsd = extractMarketPrice(card);
  const priceRm = priceUsd != null ? Math.round(priceUsd * usdToMyr * 100) / 100 : null;

  return {
    id: card.id,
    name: card.name,
    set_id: card.set.id,
    set_name: card.set.name,
    card_number: card.number,
    rarity: card.rarity ?? null,
    image_small: card.images.small,
    image_large: card.images.large,
    supertype: card.supertype,
    subtypes: card.subtypes ?? null,
    tcgplayer_market_price: priceUsd ?? null,
    market_price_rm: priceRm,
    price_updated_at: new Date().toISOString(),
  };
}

export async function syncCards(options: SyncOptions = {}): Promise<SyncResult> {
  const start = Date.now();
  const errors: string[] = [];
  const rate = options.usdToMyr ?? DEFAULT_USD_TO_MYR;
  const log = options.onProgress ?? (() => {});

  // 1. Fetch cards from pokemontcg.io
  log("Fetching cards from pokemontcg.io...");

  let cards: PokemonTcgCard[];
  if (options.since) {
    log(`Incremental sync — cards updated since ${options.since.toISOString().split("T")[0]}`);
    cards = await fetchCardsSince(options.since, options.apiKey, (fetched, total) => {
      log(`Fetched ${fetched} / ${total} cards`);
    });
  } else {
    log("Full sync — fetching all cards");
    cards = await fetchAllCards(options.apiKey, (fetched, total) => {
      log(`Fetched ${fetched} / ${total} cards`);
    });
  }

  log(`Fetched ${cards.length} cards total. Upserting to Supabase...`);

  // 2. Upsert into Supabase in batches
  const supabase = createAdminClient();
  let totalUpserted = 0;

  for (let i = 0; i < cards.length; i += UPSERT_BATCH_SIZE) {
    const batch = cards.slice(i, i + UPSERT_BATCH_SIZE);
    const rows = batch.map((c) => toCardRow(c, rate));

    const { error } = await supabase
      .from("cards")
      .upsert(rows, { onConflict: "id" });

    if (error) {
      const msg = `Batch ${Math.floor(i / UPSERT_BATCH_SIZE) + 1} error: ${error.message}`;
      errors.push(msg);
      log(`ERROR: ${msg}`);
    } else {
      totalUpserted += batch.length;
      log(`Upserted ${totalUpserted} / ${cards.length}`);
    }
  }

  const durationMs = Date.now() - start;
  log(`Sync complete: ${totalUpserted} cards in ${(durationMs / 1000).toFixed(1)}s`);

  return {
    totalFetched: cards.length,
    totalUpserted,
    durationMs,
    errors,
  };
}
