// Tier 1 nearest-neighbour search over the card_hashes table.
// ~18.5K 64-bit hashes: a linear Hamming scan in memory is ~1ms — no index
// structure needed. The catalog changes only when the hashing job runs, so the
// in-memory copy is cached per server instance with a TTL.

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { hammingHex, isValidHash } from "./phash";

export interface HashEntry {
  cardId: string;
  hashFull: string;
  hashArt: string | null;
}

export interface HashHit {
  cardId: string;
  distance: number; // Hamming distance on hash_full
  artDistance: number | null; // Hamming distance on hash_art when both sides have one
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let cache: { entries: HashEntry[]; loadedAt: number } | null = null;
let loading: Promise<HashEntry[]> | null = null;

async function fetchAllHashes(game: string): Promise<HashEntry[]> {
  const db = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const entries: HashEntry[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("card_hashes")
      .select("card_id, hash_full, hash_art")
      .eq("game", game)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      entries.push({ cardId: row.card_id, hashFull: row.hash_full, hashArt: row.hash_art });
    }
    if (!data || data.length < PAGE) break;
  }
  return entries;
}

async function getEntries(game: string): Promise<HashEntry[]> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.entries;
  if (!loading) {
    loading = fetchAllHashes(game)
      .then((entries) => {
        cache = { entries, loadedAt: Date.now() };
        return entries;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

export function invalidateHashIndex(): void {
  cache = null;
}

/** Pure k-NN over a hash list — exported for the waterfall and tests. */
export function nearestAmong(
  entries: HashEntry[],
  hashFull: string,
  hashArt: string | null,
  k: number
): HashHit[] {
  const hits: HashHit[] = [];
  for (const e of entries) {
    const distance = hammingHex(hashFull, e.hashFull);
    const artDistance =
      hashArt && e.hashArt && isValidHash(hashArt) && isValidHash(e.hashArt)
        ? hammingHex(hashArt, e.hashArt)
        : null;
    hits.push({ cardId: e.cardId, distance, artDistance });
  }
  hits.sort((a, b) => a.distance - b.distance);
  return hits.slice(0, k);
}

/**
 * k nearest catalog cards by perceptual hash. Returns [] when the index is
 * empty (hashing job not yet run) — the waterfall then skips Tier 1.
 */
export async function nearestByHash(
  hashFull: string,
  hashArt: string | null,
  k: number,
  game: string = "pokemon"
): Promise<HashHit[]> {
  if (!isValidHash(hashFull)) return [];
  try {
    const entries = await getEntries(game);
    return nearestAmong(entries, hashFull, hashArt, k);
  } catch (err) {
    console.error("[hash-index] load failed:", err);
    return [];
  }
}
