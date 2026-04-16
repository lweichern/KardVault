/**
 * pokemontcg.io API client
 *
 * Fetches all Pokémon TCG cards with pagination (250 per page).
 * Free tier: 20,000 requests/day with API key, 1,000 without.
 * Docs: https://docs.pokemontcg.io/
 */

export interface PokemonTcgCard {
  id: string;
  name: string;
  supertype: string;
  subtypes?: string[];
  number: string;
  rarity?: string;
  set: {
    id: string;
    name: string;
  };
  images: {
    small: string;
    large: string;
  };
  tcgplayer?: {
    prices?: {
      normal?: { market?: number };
      holofoil?: { market?: number };
      reverseHolofoil?: { market?: number };
      "1stEditionHolofoil"?: { market?: number };
      "1stEditionNormal"?: { market?: number };
    };
  };
}

interface PokemonTcgResponse {
  data: PokemonTcgCard[];
  page: number;
  pageSize: number;
  count: number;
  totalCount: number;
}

const API_BASE = "https://api.pokemontcg.io/v2";
const PAGE_SIZE = 250;

export async function fetchAllCards(
  apiKey?: string,
  onProgress?: (fetched: number, total: number) => void
): Promise<PokemonTcgCard[]> {
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers["X-Api-Key"] = apiKey;
  }

  const allCards: PokemonTcgCard[] = [];
  let page = 1;
  let totalCount = 0;

  do {
    const url = `${API_BASE}/cards?page=${page}&pageSize=${PAGE_SIZE}&select=id,name,supertype,subtypes,number,rarity,set,images,tcgplayer`;

    const res = await fetch(url, { headers });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `pokemontcg.io API error ${res.status}: ${text.slice(0, 200)}`
      );
    }

    const json: PokemonTcgResponse = await res.json();
    totalCount = json.totalCount;
    allCards.push(...json.data);

    onProgress?.(allCards.length, totalCount);

    page++;

    // Rate limiting — small delay between pages to be respectful
    if (allCards.length < totalCount) {
      await new Promise((r) => setTimeout(r, 200));
    }
  } while (allCards.length < totalCount);

  return allCards;
}

/**
 * Fetch only cards updated since a given date.
 * Uses the pokemontcg.io `q` parameter with set.releaseDate filter.
 * Useful for incremental syncs.
 */
export async function fetchCardsSince(
  since: Date,
  apiKey?: string,
  onProgress?: (fetched: number, total: number) => void
): Promise<PokemonTcgCard[]> {
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers["X-Api-Key"] = apiKey;
  }

  const dateStr = since.toISOString().split("T")[0]; // YYYY-MM-DD
  const allCards: PokemonTcgCard[] = [];
  let page = 1;
  let totalCount = 0;

  do {
    const url = `${API_BASE}/cards?page=${page}&pageSize=${PAGE_SIZE}&select=id,name,supertype,subtypes,number,rarity,set,images,tcgplayer&q=set.updatedAt:[${dateStr} TO *]`;

    const res = await fetch(url, { headers });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `pokemontcg.io API error ${res.status}: ${text.slice(0, 200)}`
      );
    }

    const json: PokemonTcgResponse = await res.json();
    totalCount = json.totalCount;
    allCards.push(...json.data);

    onProgress?.(allCards.length, totalCount);

    page++;

    if (allCards.length < totalCount) {
      await new Promise((r) => setTimeout(r, 200));
    }
  } while (allCards.length < totalCount);

  return allCards;
}

/**
 * Extract the best market price from TCGplayer price variants.
 * Priority: holofoil > reverseHolofoil > normal > 1stEdition variants.
 */
export function extractMarketPrice(card: PokemonTcgCard): number | null {
  const prices = card.tcgplayer?.prices;
  if (!prices) return null;

  return (
    prices.holofoil?.market ??
    prices.reverseHolofoil?.market ??
    prices.normal?.market ??
    prices["1stEditionHolofoil"]?.market ??
    prices["1stEditionNormal"]?.market ??
    null
  );
}
