import type { RawSet, RawCard } from "./types";

const GITHUB_RAW_BASE =
  "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master";

export interface SourceOptions {
  localPath?: string;
  onProgress?: (msg: string) => void;
}

async function readLocal<T>(filePath: string): Promise<T | null> {
  const fs = await import("fs/promises");
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json() as Promise<T>;
}

export async function fetchSets(options: SourceOptions = {}): Promise<RawSet[]> {
  const { localPath, onProgress } = options;

  if (localPath) {
    const path = await import("path");
    const filePath = path.join(localPath, "sets", "en.json");
    onProgress?.(`Reading sets from ${filePath}`);
    const data = await readLocal<RawSet[]>(filePath);
    return data ?? [];
  }

  const url = `${GITHUB_RAW_BASE}/sets/en.json`;
  onProgress?.(`Fetching sets from ${url}`);
  const data = await fetchJson<RawSet[]>(url);
  return data ?? [];
}

export async function fetchCardsForSet(
  setId: string,
  options: SourceOptions = {}
): Promise<RawCard[]> {
  const { localPath, onProgress } = options;

  if (localPath) {
    const path = await import("path");
    const filePath = path.join(localPath, "cards", "en", `${setId}.json`);
    onProgress?.(`Reading cards for set ${setId} from ${filePath}`);
    const data = await readLocal<RawCard[]>(filePath);
    return data ?? [];
  }

  const url = `${GITHUB_RAW_BASE}/cards/en/${setId}.json`;
  onProgress?.(`Fetching cards for set ${setId}`);
  const data = await fetchJson<RawCard[]>(url);
  return data ?? [];
}

export async function fetchAllCards(
  sets: RawSet[],
  options: SourceOptions = {}
): Promise<RawCard[]> {
  const { onProgress } = options;
  const CONCURRENCY = 10;
  const allCards: RawCard[] = [];

  for (let i = 0; i < sets.length; i += CONCURRENCY) {
    const batch = sets.slice(i, i + CONCURRENCY);
    onProgress?.(
      `Fetching cards for sets ${i + 1}–${Math.min(i + CONCURRENCY, sets.length)} of ${sets.length}`
    );
    const results = await Promise.all(
      batch.map((set) => fetchCardsForSet(set.id, options))
    );
    for (const cards of results) {
      allCards.push(...cards);
    }
  }

  return allCards;
}
