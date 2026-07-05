import * as dotenv from "dotenv";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

// TCGCSV → Supabase price sync (CLAUDE-enhance.md §5.1).
// Category 3 = Pokémon. Pulls every group, its products (singles AND sealed),
// and current TCGplayer prices. Prices are UPSERTED so re-running daily keeps
// them fresh; products/groups update in place.
//
// Usage:
//   npm run sync:prices                 # full sync: groups + products + prices
//   npm run sync:prices -- --prices-only  # skip product metadata (fast daily run)
//   npm run sync:prices -- --group 24722  # one group only
//   npm run sync:prices -- --dry-run      # fetch + parse, no DB writes

const CATEGORY = 3; // Pokémon
const BASE = `https://tcgcsv.com/tcgplayer/${CATEGORY}`;
const CONCURRENCY = 6;
const BATCH = 500;

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const PRICES_ONLY = args.includes("--prices-only");
const ONLY_GROUP = (() => {
  const i = args.indexOf("--group");
  return i !== -1 && args[i + 1] ? parseInt(args[i + 1], 10) : null;
})();

interface TcgGroup {
  groupId: number;
  name: string;
  abbreviation?: string;
  isSupplemental?: boolean;
  publishedOn?: string;
  categoryId: number;
}

interface TcgProduct {
  productId: number;
  name: string;
  cleanName?: string;
  imageUrl?: string;
  groupId: number;
  url?: string;
  extendedData?: { name: string; value: string }[];
}

interface TcgPrice {
  productId: number;
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
  marketPrice: number | null;
  directLowPrice: number | null;
  subTypeName: string;
}

async function fetchJson<T>(url: string): Promise<T[]> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(20000),
        // TCGCSV returns 401 to requests without a User-Agent
        headers: { "User-Agent": "KardVault-price-sync/1.0 (kard-vault.vercel.app)" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { results?: T[] } | T[];
      return Array.isArray(body) ? body : (body.results ?? []);
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  return [];
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  return createClient<Database>(url, key);
}

async function upsertBatched<T extends object>(
  db: ReturnType<typeof getSupabase>,
  table: "tcg_groups" | "tcg_products" | "tcg_prices",
  rows: T[],
  onConflict: string
): Promise<number> {
  if (DRY_RUN || rows.length === 0) return 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await db.from(table).upsert(chunk as any, { onConflict });
    if (error) {
      console.error(`  ${table} upsert failed:`, error.message);
      failed += chunk.length;
    }
  }
  return failed;
}

async function main() {
  console.log("");
  console.log("╔══════════════════════════════════════╗");
  console.log("║   KardVault — TCGCSV Price Sync      ║");
  console.log("╚══════════════════════════════════════╝");
  console.log(DRY_RUN ? "(dry run — no DB writes)\n" : "");

  const db = getSupabase();

  // ── 1. Groups ───────────────────────────────────────────────────────────────
  let groups = await fetchJson<TcgGroup>(`${BASE}/groups`);
  if (ONLY_GROUP) groups = groups.filter((g) => g.groupId === ONLY_GROUP);
  console.log(`Groups: ${groups.length}`);

  const groupRows = groups.map((g) => ({
    group_id: g.groupId,
    name: g.name,
    abbreviation: g.abbreviation ?? null,
    is_supplemental: g.isSupplemental ?? false,
    published_on: g.publishedOn ?? null,
    category_id: g.categoryId,
    updated_at: new Date().toISOString(),
  }));
  await upsertBatched(db, "tcg_groups", groupRows, "group_id");

  // ── 2. Products + prices per group ─────────────────────────────────────────
  let totalProducts = 0;
  let totalSealed = 0;
  let totalPrices = 0;
  const failedGroups: number[] = [];

  for (let i = 0; i < groups.length; i += CONCURRENCY) {
    const chunk = groups.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (g) => {
        try {
          const prices = await fetchJson<TcgPrice>(`${BASE}/${g.groupId}/prices`);

          if (!PRICES_ONLY) {
            const products = await fetchJson<TcgProduct>(`${BASE}/${g.groupId}/products`);
            const productRows = products.map((p) => {
              const ext = new Map((p.extendedData ?? []).map((e) => [e.name, e.value]));
              const cardNumber = ext.get("Number") ?? null;
              return {
                product_id: p.productId,
                group_id: p.groupId,
                name: p.name,
                clean_name: p.cleanName ?? null,
                image_url: p.imageUrl ?? null,
                url: p.url ?? null,
                card_number: cardNumber,
                rarity: ext.get("Rarity") ?? null,
                is_sealed: cardNumber === null,
                updated_at: new Date().toISOString(),
              };
            });
            totalProducts += productRows.length;
            totalSealed += productRows.filter((r) => r.is_sealed).length;
            await upsertBatched(db, "tcg_products", productRows, "product_id");
          }

          const priceRows = prices.map((p) => ({
            product_id: p.productId,
            sub_type_name: p.subTypeName || "Normal",
            market_price: p.marketPrice,
            low_price: p.lowPrice,
            mid_price: p.midPrice,
            high_price: p.highPrice,
            direct_low_price: p.directLowPrice,
            updated_at: new Date().toISOString(),
          }));
          totalPrices += priceRows.length;
          await upsertBatched(db, "tcg_prices", priceRows, "product_id,sub_type_name");
        } catch (err) {
          console.error(`  group ${g.groupId} (${g.name}) failed:`, (err as Error).message);
          failedGroups.push(g.groupId);
        }
      })
    );
    if ((i + CONCURRENCY) % 30 < CONCURRENCY) {
      console.log(`  ${Math.min(i + CONCURRENCY, groups.length)}/${groups.length} groups processed`);
    }
  }

  console.log("");
  console.log(
    `Done. ${PRICES_ONLY ? "" : `products: ${totalProducts} (${totalSealed} sealed), `}prices: ${totalPrices}`
  );
  if (failedGroups.length > 0) {
    console.error(`Failed groups (${failedGroups.length}): ${failedGroups.join(", ")}`);
    console.error("Re-run to retry — upserts are idempotent.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
