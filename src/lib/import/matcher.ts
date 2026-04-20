import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCondition } from "./condition-normalizer";
import { parseGrading } from "./grading-parser";
import type { CardCandidate, ColumnMapping, MatchResult, ParsedFile } from "./types";

const BATCH_SIZE = 50;

export type Condition = "NM" | "LP" | "MP" | "HP" | "DMG";

function getField(
  row: Record<string, string>,
  mapping: ColumnMapping[],
  field: ColumnMapping["field"]
): string | null {
  const col = mapping.find((m) => m.field === field);
  if (!col) return null;
  const v = row[col.columnName];
  return v == null ? null : v.toString().trim() || null;
}

function parseFloatOrNull(v: string | null): number | null {
  if (!v) return null;
  const cleaned = v.replace(/[^\d.\-]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseIntOrOne(v: string | null): number {
  if (!v) return 1;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function buildMappedFields(
  row: Record<string, string>,
  mapping: ColumnMapping[],
  defaultCondition: Condition
): MatchResult["mappedFields"] {
  const conditionRaw = getField(row, mapping, "condition");
  const condition = normalizeCondition(conditionRaw) ?? defaultCondition;
  const gradingRaw = getField(row, mapping, "grading");
  const grading = parseGrading(gradingRaw);
  return {
    sellPriceRm: parseFloatOrNull(getField(row, mapping, "sell_price")),
    buyPriceRm: parseFloatOrNull(getField(row, mapping, "buy_price")),
    condition,
    quantity: parseIntOrOne(getField(row, mapping, "quantity")),
    gradingCompany: grading?.gradingCompany ?? null,
    grade: grading?.grade ?? null,
  };
}

export function classifyCandidates(cands: CardCandidate[]): MatchResult["status"] {
  if (cands.length === 0) return "not_found";
  const top = cands[0].score;
  if (top < 0.4) return "not_found";
  if (top < 0.7) return "uncertain";
  if (cands.length >= 2 && top - cands[1].score < 0.05) return "uncertain";
  return "matched";
}

async function fetchCandidates(
  supabase: SupabaseClient,
  name: string,
  setHint: string | null,
  numberHint: string | null
): Promise<CardCandidate[]> {
  const { data, error } = await supabase.rpc("match_cards", {
    p_name: name,
    p_set_hint: setHint,
    p_number_hint: numberHint,
  });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    name: r.name as string,
    setName: r.set_name as string,
    cardNumber: (r.number as string) ?? "",
    imageSmall: (r.image_small as string | null) ?? null,
    marketPriceRm: null,
    score: r.score as number,
  }));
}

export async function matchRows(
  supabase: SupabaseClient,
  parsed: ParsedFile,
  mapping: ColumnMapping[],
  defaultCondition: Condition = "NM"
): Promise<MatchResult[]> {
  const nameCol = mapping.find((m) => m.field === "card_name");
  if (!nameCol) throw new Error("card_name column must be mapped before matching");

  const results: MatchResult[] = [];
  for (let start = 0; start < parsed.rows.length; start += BATCH_SIZE) {
    const chunk = parsed.rows.slice(start, start + BATCH_SIZE);
    const chunkResults = await Promise.all(
      chunk.map(async (row, localIdx) => {
        const idx = start + localIdx;
        const name = (row[nameCol.columnName] ?? "").trim();
        if (!name) {
          return {
            rowIndex: idx,
            rawCardName: "",
            status: "not_found",
            candidates: [],
            selectedCardId: null,
            mappedFields: buildMappedFields(row, mapping, defaultCondition),
          } satisfies MatchResult;
        }
        const setHint = getField(row, mapping, "set");
        const numberHint = getField(row, mapping, "card_number");
        const cands = await fetchCandidates(supabase, name, setHint, numberHint);
        const status = classifyCandidates(cands);
        return {
          rowIndex: idx,
          rawCardName: name,
          status,
          candidates: cands,
          selectedCardId: status === "matched" ? cands[0].id : null,
          mappedFields: buildMappedFields(row, mapping, defaultCondition),
        } satisfies MatchResult;
      })
    );
    results.push(...chunkResults);
  }
  return results;
}
