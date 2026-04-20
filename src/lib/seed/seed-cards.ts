import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchSets, fetchAllCards, fetchCardsForSet } from "./github-source";
import type { RawSet, RawCard } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

export interface SeedOptions {
  /** Only seed a specific set by ID (e.g. "sv1"). Seeds all sets if omitted. */
  setId?: string;
  /** Only upsert card_sets — skip cards entirely. */
  setsOnly?: boolean;
  /** Local filesystem path to pokemon-tcg-data clone. Fetches from GitHub if omitted. */
  localPath?: string;
  /** Progress callback invoked with human-readable status messages. */
  onProgress?: (msg: string) => void;
}

export interface SeedResult {
  setsUpserted: number;
  cardsUpserted: number;
  durationMs: number;
  errors: string[];
}

const BATCH_SIZE = 500;

function mapSetToRow(set: RawSet) {
  return {
    id: set.id,
    name: set.name,
    series: set.series,
    printed_total: set.printedTotal,
    total: set.total,
    ptcgo_code: set.ptcgoCode ?? null,
    release_date: set.releaseDate ?? null,
    image_symbol: set.images.symbol,
    image_logo: set.images.logo,
    updated_at: new Date().toISOString(),
  };
}

function mapCardToRow(card: RawCard) {
  return {
    id: card.id,
    name: card.name,
    supertype: card.supertype ?? null,
    subtypes: card.subtypes ?? null,
    hp: card.hp ?? null,
    types: card.types ?? null,
    evolves_from: card.evolvesFrom ?? null,
    evolves_to: card.evolvesTo ?? null,
    set_id: card.set.id,
    set_name: card.set.name,
    set_series: card.set.series ?? null,
    number: card.number,
    rarity: card.rarity ?? null,
    artist: card.artist ?? null,
    attacks: card.attacks ? JSON.stringify(card.attacks) : null,
    weaknesses: card.weaknesses ? JSON.stringify(card.weaknesses) : null,
    resistances: card.resistances ? JSON.stringify(card.resistances) : null,
    retreat_cost: card.retreatCost ?? null,
    converted_retreat_cost: card.convertedRetreatCost ?? null,
    rules: card.rules ?? null,
    abilities: card.abilities ? JSON.stringify(card.abilities) : null,
    flavor_text: card.flavorText ?? null,
    image_small: card.images.small,
    image_large: card.images.large,
    national_pokedex_numbers: card.nationalPokedexNumbers ?? null,
    legality_standard: card.legalities?.standard ?? null,
    legality_expanded: card.legalities?.expanded ?? null,
    legality_unlimited: card.legalities?.unlimited ?? null,
    regulation_mark: card.regulationMark ?? null,
    updated_at: new Date().toISOString(),
  };
}

async function upsertBatch<T extends object>(
  supabase: AnySupabaseClient,
  table: string,
  rows: T[],
  onProgress?: (msg: string) => void
): Promise<{ upserted: number; errors: string[] }> {
  const errors: string[] = [];
  let upserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    onProgress?.(
      `Upserting ${table} rows ${i + 1}–${Math.min(i + BATCH_SIZE, rows.length)} of ${rows.length}`
    );
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict: "id" });

    if (error) {
      errors.push(`${table} batch ${i}–${i + BATCH_SIZE}: ${error.message}`);
    } else {
      upserted += batch.length;
    }
  }

  return { upserted, errors };
}

export async function seedCards(options: SeedOptions = {}): Promise<SeedResult> {
  const { setId, setsOnly = false, localPath, onProgress } = options;
  const startMs = Date.now();
  const errors: string[] = [];

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const sourceOptions = { localPath, onProgress };

  // ── Step 1: Fetch sets ───────────────────────────────────────────────────
  onProgress?.("Fetching sets…");
  let sets = await fetchSets(sourceOptions);

  if (setId) {
    sets = sets.filter((s) => s.id === setId);
    if (sets.length === 0) {
      throw new Error(`Set "${setId}" not found in source data.`);
    }
    onProgress?.(`Filtered to set "${setId}"`);
  }

  onProgress?.(`${sets.length} set(s) to process`);

  // ── Step 2: Upsert card_sets ─────────────────────────────────────────────
  const setRows = sets.map(mapSetToRow);
  const setsResult = await upsertBatch(supabase, "card_sets", setRows, onProgress);
  errors.push(...setsResult.errors);
  onProgress?.(`card_sets upserted: ${setsResult.upserted}`);

  // ── Step 3: Fetch + upsert cards (unless --sets-only) ────────────────────
  let cardsUpserted = 0;

  if (!setsOnly) {
    onProgress?.("Fetching cards…");

    let rawCards: RawCard[];
    if (setId) {
      rawCards = await fetchCardsForSet(setId, sourceOptions);
    } else {
      rawCards = await fetchAllCards(sets, sourceOptions);
    }

    onProgress?.(`${rawCards.length} card(s) fetched`);

    const cardRows = rawCards.map(mapCardToRow);
    const cardsResult = await upsertBatch(supabase, "cards", cardRows, onProgress);
    errors.push(...cardsResult.errors);
    cardsUpserted = cardsResult.upserted;
    onProgress?.(`cards upserted: ${cardsUpserted}`);
  }

  const durationMs = Date.now() - startMs;

  return {
    setsUpserted: setsResult.upserted,
    cardsUpserted,
    durationMs,
    errors,
  };
}
