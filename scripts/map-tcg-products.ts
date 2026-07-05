import * as dotenv from "dotenv";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

// Maps tcg_products (TCGplayer) → cards (pokemon-tcg-data) by filling
// tcg_products.card_id. Matching key, strongest first:
//   1. collector number numerator (leading zeros stripped)
//   2. set size — product's "/128" denominator vs card_sets printed_total/total
//   3. card name (normalized exact, then prefix)
// No set-name↔group-name mapping needed — number+size+name is near-unique.
//
// Usage:
//   npm run map:products              # match and write card_id
//   npm run map:products -- --dry-run # report match rate only

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const BATCH = 500;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env vars");
    process.exit(1);
  }
  return createClient<Database>(url, key);
}

/** "025" → "25", "TG15" stays, uppercase. */
function stripNumber(n: string): string {
  return n.toUpperCase().trim().replace(/^([A-Z]*)0+(\d)/, "$1$2");
}

/** Normalize a card name for equality comparison. */
function normName(n: string): string {
  return n
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // é → e
    .replace(/&/g, "and")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchAll<T>(
  db: ReturnType<typeof getSupabase>,
  table: "cards" | "card_sets" | "tcg_products",
  columns: string,
  filter?: (q: ReturnType<ReturnType<typeof getSupabase>["from"]>["select"] extends never ? never : unknown) => unknown
): Promise<T[]> {
  void filter;
  const rows: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .order(table === "tcg_products" ? "product_id" : "id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

interface CardRow {
  id: string;
  name: string;
  number: string | null;
  set_id: string | null;
}
interface SetRow {
  id: string;
  printed_total: number | null;
  total: number | null;
}
interface ProductRow {
  product_id: number;
  group_id: number;
  name: string;
  card_number: string | null;
  card_id: string | null;
}

async function main() {
  console.log("");
  console.log("╔══════════════════════════════════════╗");
  console.log("║  KardVault — TCG Product Mapper      ║");
  console.log("╚══════════════════════════════════════╝");
  console.log(DRY_RUN ? "(dry run — no writes)\n" : "");

  const db = getSupabase();

  const [cards, sets, products] = await Promise.all([
    fetchAll<CardRow>(db, "cards", "id, name, number, set_id"),
    fetchAll<SetRow>(db, "card_sets", "id, printed_total, total"),
    fetchAll<ProductRow>(db, "tcg_products", "product_id, group_id, name, card_number, card_id"),
  ]);
  const singles = products.filter((p) => p.card_number);
  console.log(`cards: ${cards.length}, products with numbers: ${singles.length}`);

  const setById = new Map(sets.map((s) => [s.id, s]));

  // Index cards by stripped number numerator
  const byNumber = new Map<string, CardRow[]>();
  for (const c of cards) {
    if (!c.number) continue;
    const key = stripNumber(c.number);
    const list = byNumber.get(key) ?? [];
    list.push(c);
    byNumber.set(key, list);
  }

  let matched = 0;
  let ambiguous = 0;
  let noCandidate = 0;
  const updates: { product_id: number; card_id: string }[] = [];
  const ambiguousSamples: string[] = [];

  for (const p of singles) {
    // "021/128" → numerator "21", denominator 128; "TG15/TG30" → "TG15", null
    const m = p.card_number!.match(/^\s*([A-Za-z]{0,4}\d+[a-z]?)\s*(?:\/\s*([A-Za-z]{0,4}\d+))?\s*$/);
    if (!m) {
      noCandidate++;
      continue;
    }
    const num = stripNumber(m[1]);
    const denom = m[2] && /^\d+$/.test(m[2]) ? parseInt(m[2], 10) : null;

    let candidates = byNumber.get(num) ?? [];

    // Filter by set size when the product prints one
    if (denom !== null && candidates.length > 0) {
      const bySize = candidates.filter((c) => {
        const s = c.set_id ? setById.get(c.set_id) : null;
        return s ? s.printed_total === denom || s.total === denom : false;
      });
      if (bySize.length > 0) candidates = bySize;
    }

    if (candidates.length === 0) {
      noCandidate++;
      continue;
    }

    // Name check: exact normalized, then prefix (TCGplayer suffixes variants)
    const pName = normName(p.name);
    let final = candidates.filter((c) => normName(c.name) === pName);
    if (final.length === 0) {
      final = candidates.filter(
        (c) => pName.startsWith(normName(c.name)) || normName(c.name).startsWith(pName)
      );
    }

    if (final.length === 1) {
      matched++;
      if (p.card_id !== final[0].id) {
        updates.push({ product_id: p.product_id, card_id: final[0].id });
      }
    } else if (final.length > 1) {
      ambiguous++;
      if (ambiguousSamples.length < 5) {
        ambiguousSamples.push(
          `${p.name} #${p.card_number} → ${final.map((c) => c.id).join(", ")}`
        );
      }
    } else {
      noCandidate++;
    }
  }

  console.log("");
  console.log(`matched:      ${matched} (${((matched / singles.length) * 100).toFixed(1)}%)`);
  console.log(`ambiguous:    ${ambiguous}`);
  console.log(`no candidate: ${noCandidate} (mostly sets newer than the card catalog, or JP-only)`);
  if (ambiguousSamples.length > 0) {
    console.log("ambiguous samples:");
    for (const s of ambiguousSamples) console.log(`  - ${s}`);
  }

  if (DRY_RUN) return;

  console.log("");
  console.log(`writing ${updates.length} card_id links...`);
  let failed = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH);
    // Per-row values differ → RPC-free approach: update one batch via upsert
    // needs full rows; instead run parallel updates in small groups.
    const results = await Promise.all(
      chunk.map((u) =>
        db.from("tcg_products").update({ card_id: u.card_id }).eq("product_id", u.product_id)
      )
    );
    failed += results.filter((r) => r.error).length;
    if ((i + BATCH) % 5000 < BATCH) console.log(`  ${Math.min(i + BATCH, updates.length)}/${updates.length}`);
  }
  console.log(`done. failed updates: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
