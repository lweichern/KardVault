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
  score?: number; // combined ranking score — see hashScore(); derived when absent
}

/**
 * Combined ranking score. Full-hash distance alone mis-ranks real photos:
 * random cards collide at 10–12 bits while the true card (foil shine, warp
 * offset) sits at 14–20. True matches are strong on BOTH hashes; collisions
 * almost never are. Missing art hash gets a penalty so it can't win ties.
 */
export function hashScore(distance: number, artDistance: number | null): number {
  return artDistance !== null ? distance + artDistance : distance * 2 + 4;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let cache: { entries: HashEntry[]; loadedAt: number } | null = null;
let loading: Promise<HashEntry[]> | null = null;

async function fetchAllHashes(game: string): Promise<HashEntry[]> {
  const db = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const PAGE = 1000;

  // ~20K rows = ~21 pages. Fetch them in parallel — a sequential loop adds
  // seconds to every serverless cold start (the first scan pays for it).
  const { count, error: countError } = await db
    .from("card_hashes")
    .select("*", { count: "exact", head: true })
    .eq("game", game);
  if (countError) throw countError;
  const total = count ?? 0;
  if (total === 0) return [];

  const pageStarts = Array.from({ length: Math.ceil(total / PAGE) }, (_, i) => i * PAGE);
  const pages = await Promise.all(
    pageStarts.map(async (from) => {
      const { data, error } = await db
        .from("card_hashes")
        .select("card_id, hash_full, hash_art")
        .eq("game", game)
        .order("card_id")
        .range(from, from + PAGE - 1);
      if (error) throw error;
      return data ?? [];
    })
  );

  return pages.flat().map((row) => ({
    cardId: row.card_id,
    hashFull: row.hash_full,
    hashArt: row.hash_art,
  }));
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
    hits.push({ cardId: e.cardId, distance, artDistance, score: hashScore(distance, artDistance) });
  }
  hits.sort((a, b) => a.score - b.score);
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
