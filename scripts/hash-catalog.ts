import * as dotenv from "dotenv";
import * as path from "path";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { phash } from "../src/lib/scan/phash";
import { cropFraction, type RawImage } from "../src/lib/scan/raw-image";
import { getCatalogProvider } from "../src/lib/catalog";
import type { Database } from "../src/types/database";

// Load .env.local from the project root
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

// One-time catalog job (CLAUDE-enhance.md §2 Tier 1): compute perceptual
// hashes for every card image → card_hashes table. Resumable: already-hashed
// cards are skipped unless --force is passed.
//
// Usage:
//   npm run hash:catalog             # hash cards missing from card_hashes
//   npm run hash:catalog -- --force  # rehash everything

const GAME = "pokemon";
const CONCURRENCY = 8;
const UPSERT_BATCH = 200;
const force = process.argv.includes("--force");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const db = createClient<Database>(supabaseUrl, serviceKey);

interface CardRow {
  id: string;
  image_small: string | null;
  image_large: string | null;
}

async function fetchAllCards(): Promise<CardRow[]> {
  const rows: CardRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("cards")
      .select("id, image_small, image_large")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function fetchHashedIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("card_hashes")
      .select("card_id")
      .eq("game", GAME)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const row of data ?? []) ids.add(row.card_id);
    if (!data || data.length < PAGE) break;
  }
  return ids;
}

async function imageToRaw(url: string): Promise<RawImage> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
  };
}

async function hashCard(card: CardRow): Promise<{
  game: string;
  card_id: string;
  printing_id: string;
  hash_full: string;
  hash_art: string;
} | null> {
  // image_small (245×342) is plenty for a 32×32 pHash
  const url = card.image_small ?? card.image_large;
  if (!url) return null;

  const raw = await imageToRaw(url);
  const artSpec = getCatalogProvider(GAME).identifierRegions().find((r) => r.key === "art")!;
  const art = cropFraction(raw, artSpec.x, artSpec.y, artSpec.w, artSpec.h);

  return {
    game: GAME,
    card_id: card.id,
    printing_id: "",
    hash_full: phash(raw),
    hash_art: phash(art),
  };
}

async function main() {
  console.log("");
  console.log("╔══════════════════════════════════════╗");
  console.log("║     KadVault — Catalog Hasher        ║");
  console.log("╚══════════════════════════════════════╝");
  console.log("");

  const cards = await fetchAllCards();
  const done = force ? new Set<string>() : await fetchHashedIds();
  const todo = cards.filter((c) => !done.has(c.id) && (c.image_small || c.image_large));
  const skippedNoImage = cards.filter((c) => !c.image_small && !c.image_large).length;

  console.log(`Catalog: ${cards.length} cards`);
  console.log(`Already hashed: ${done.size}${force ? " (ignored via --force)" : ""}`);
  if (skippedNoImage > 0) console.log(`No image (skipped): ${skippedNoImage}`);
  console.log(`To hash: ${todo.length}`);
  console.log("");

  const failed: string[] = [];
  let processed = 0;
  let pending: NonNullable<Awaited<ReturnType<typeof hashCard>>>[] = [];

  const flush = async () => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    const { error } = await db
      .from("card_hashes")
      .upsert(batch, { onConflict: "game,card_id,printing_id" });
    if (error) {
      console.error("Upsert failed:", error.message);
      failed.push(...batch.map((b) => b.card_id));
    }
  };

  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const chunk = todo.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(chunk.map(hashCard));
    results.forEach((r, idx) => {
      if (r.status === "fulfilled" && r.value) {
        pending.push(r.value);
      } else if (r.status === "rejected") {
        failed.push(chunk[idx].id);
      }
    });
    if (pending.length >= UPSERT_BATCH) await flush();

    processed += chunk.length;
    if (processed % 500 < CONCURRENCY) {
      console.log(`  ${processed}/${todo.length} processed (${failed.length} failed)`);
    }
  }
  await flush();

  console.log("");
  console.log(`Done. Hashed ${processed - failed.length}/${todo.length}.`);
  if (failed.length > 0) {
    console.error(`Failed ids (${failed.length}):`);
    for (const id of failed) console.error(`  - ${id}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
