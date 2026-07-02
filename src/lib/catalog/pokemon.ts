// Pokémon catalog provider. Cleanest identification case (CLAUDE-enhance.md §6):
// collector number + set total ("123/198") printed on the bottom strip.
// Catalog numbers (pokemon-tcg-data) are stored WITHOUT the total and without
// leading zeros for plain numerics ("25", "TG15", "SWSH123").

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Card, CatalogProvider, CropSpec, FuzzyFields, ParsedId } from "./types";

// "123/198", "025/198", "TG15/TG30", "GG56/GG70"
const NUMBER_SLASH_RE = /([A-Z]{0,3}\d{1,3}[a-z]?)\s*\/\s*([A-Z]{0,3}\d{1,3})/;
// Promo formats without a total: "SVP 123", "SWSH250", "SM210", "XY67"…
const PROMO_RE = /\b(SVP|SWSH|SM|XY|BW|HGSS|DP)[\s-]?(\d{1,3})\b/i;

/**
 * Catalog number variants worth trying for a parsed identifier, most specific
 * first. "025" → ["025", "25"]; "TG15" → ["TG15"]; promo "SWSH 123" → ["SWSH123", "123"].
 */
export function numberVariants(parsed: ParsedId): string[] {
  const variants: string[] = [];
  const push = (v: string | undefined) => {
    if (v && !variants.includes(v)) variants.push(v);
  };
  if (parsed.number) {
    const n = parsed.number.toUpperCase();
    push(n);
    const stripped = n.replace(/^([A-Z]*)0+(\d)/, "$1$2");
    push(stripped);
    // Promo prefix+digits stored either combined or digits-only depending on set
    const m = n.match(/^([A-Z]+)(\d+)$/);
    if (m) push(m[2].replace(/^0+(\d)/, "$1"));
  }
  return variants;
}

export class PokemonCatalogProvider implements CatalogProvider {
  game = "pokemon" as const;

  identifierRegions(): CropSpec[] {
    return [
      // Bottom strip — collector number sits bottom-left on modern cards,
      // bottom-right on older layouts; take the full strip.
      { key: "identifier", x: 0, y: 0.88, w: 1, h: 0.12 },
      // Standard art box for regular-frame cards.
      { key: "art", x: 0.09, y: 0.11, w: 0.82, h: 0.36 },
    ];
  }

  parseIdentifier(ocrText: string): ParsedId | null {
    const text = ocrText.toUpperCase();

    const slash = text.match(NUMBER_SLASH_RE);
    if (slash) {
      const denominator = slash[2];
      const setTotal = /^\d+$/.test(denominator) ? parseInt(denominator, 10) : undefined;
      return { number: slash[1], setTotal, raw: ocrText };
    }

    const promo = text.match(PROMO_RE);
    if (promo) {
      return {
        number: `${promo[1]}${promo[2]}`,
        setCode: promo[1],
        raw: ocrText,
      };
    }

    return null;
  }

  async lookup(parsed: ParsedId, db: SupabaseClient<Database>): Promise<Card[]> {
    const variants = numberVariants(parsed);
    if (variants.length === 0) return [];

    // Restrict by set total when we parsed one ("123/198" → sets printing 198)
    let setIds: string[] | null = null;
    if (parsed.setTotal) {
      const { data: sets } = await db
        .from("card_sets")
        .select("id")
        .or(`printed_total.eq.${parsed.setTotal},total.eq.${parsed.setTotal}`);
      setIds = (sets ?? []).map((s) => s.id);
      if (setIds.length === 0) setIds = null; // unknown total — fall back to number-only
    }

    let query = db.from("cards").select("*").in("number", variants).limit(10);
    if (setIds) query = query.in("set_id", setIds);
    const { data } = await query;
    const cards = (data ?? []) as Card[];

    // Prefer exact variant order (most specific first)
    return cards.sort(
      (a, b) =>
        variants.indexOf((a.number ?? "").toUpperCase()) -
        variants.indexOf((b.number ?? "").toUpperCase())
    );
  }

  async fuzzyLookup(fields: FuzzyFields, db: SupabaseClient<Database>): Promise<Card[]> {
    if (fields.name) {
      const { data: matches } = await db.rpc("match_cards", {
        p_name: fields.name,
        p_set_hint: undefined,
        p_number_hint: fields.number ?? undefined,
      });
      const ids = (matches ?? []).map((m: { id: string }) => m.id);
      if (ids.length > 0) {
        const { data } = await db.from("cards").select("*").in("id", ids);
        const cards = (data ?? []) as Card[];
        return cards.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      }
    }

    if (fields.number) {
      const parsed: ParsedId = {
        number: fields.number,
        setTotal: fields.setTotal ?? undefined,
        raw: fields.number,
      };
      return this.lookup(parsed, db);
    }

    return [];
  }
}
