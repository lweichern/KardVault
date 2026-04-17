import { normalizeCondition } from "./condition-normalizer";
import type { ColumnMapping, KardVaultField, ParsedFile } from "./types";

const ALIASES: Record<KardVaultField, string[]> = {
  card_name: ["name", "card name", "card", "item", "product", "card_name", "product name", "item name"],
  set: ["set", "set name", "expansion", "series", "edition", "set code", "set_code"],
  card_number: ["number", "card number", "no", "#", "card_number", "collector number", "collector_number"],
  sell_price: ["price", "sell price", "sell", "my price", "tcg marketplace price", "marketplace price", "asking price"],
  buy_price: ["buy price", "cost price", "purchase price", "paid", "price bought", "purchase_price", "cost"],
  condition: ["condition", "cond", "quality"],
  quantity: ["qty", "quantity", "count", "amount", "total quantity", "add to quantity", "tradelist count"],
  grading: ["grade", "grading", "graded", "grader"],
};

const CARD_NUMBER_RE = /^(\d{1,4}\/\d{1,4}|[A-Z]{1,4}\d{1,4}(-\d{1,4})?)$/;
const POSITIVE_INT_RE = /^\d{1,4}$/;
const POSITIVE_FLOAT_RE = /^\d+(\.\d+)?$/;
const GRADING_RE = /(PSA|BGS|CGC|ACE|SGC)\s*\d+(\.\d+)?/i;

function normalize(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const ALIAS_INDEX: Map<string, KardVaultField> = (() => {
  const idx = new Map<string, KardVaultField>();
  for (const [field, aliases] of Object.entries(ALIASES) as [KardVaultField, string[]][]) {
    for (const alias of aliases) idx.set(normalize(alias), field);
  }
  return idx;
})();

function sampleValuesFor(parsed: ParsedFile, column: string, n = 3): string[] {
  const out: string[] = [];
  for (const row of parsed.rows) {
    const v = (row[column] ?? "").toString().trim();
    if (v) out.push(v);
    if (out.length === n) break;
  }
  return out;
}

function nonEmptyValues(parsed: ParsedFile, column: string): string[] {
  const out: string[] = [];
  for (const row of parsed.rows) {
    const v = (row[column] ?? "").toString().trim();
    if (v) out.push(v);
  }
  return out;
}

function percentMatch(values: string[], test: (v: string) => boolean): number {
  if (values.length === 0) return 0;
  const hits = values.reduce((n, v) => (test(v) ? n + 1 : n), 0);
  return hits / values.length;
}

function guessByPattern(values: string[], claimed: Set<KardVaultField>): KardVaultField | null {
  if (values.length === 0) return null;
  if (!claimed.has("card_number") && percentMatch(values, (v) => CARD_NUMBER_RE.test(v)) >= 0.8) {
    return "card_number";
  }
  if (!claimed.has("quantity") && percentMatch(values, (v) => POSITIVE_INT_RE.test(v) && parseInt(v, 10) > 0 && parseInt(v, 10) < 10000) >= 0.9) {
    return "quantity";
  }
  if (!claimed.has("sell_price") && percentMatch(values, (v) => POSITIVE_FLOAT_RE.test(v) && parseFloat(v) > 0 && parseFloat(v) < 100000) >= 0.8) {
    return "sell_price";
  }
  if (!claimed.has("condition") && percentMatch(values, (v) => normalizeCondition(v) !== null) >= 0.7) {
    return "condition";
  }
  if (!claimed.has("grading") && percentMatch(values, (v) => GRADING_RE.test(v)) >= 0.3) {
    return "grading";
  }
  return null;
}

export function detectColumns(parsed: ParsedFile): ColumnMapping[] {
  const claimed = new Set<KardVaultField>();
  const mappings: ColumnMapping[] = parsed.headers.map((header) => ({
    columnName: header,
    field: "skip" as KardVaultField | "skip",
    confidence: "manual" as ColumnMapping["confidence"],
    sampleValues: sampleValuesFor(parsed, header),
  }));

  // Pass 1 — header match
  mappings.forEach((m) => {
    const field = ALIAS_INDEX.get(normalize(m.columnName));
    if (field && !claimed.has(field)) {
      claimed.add(field);
      m.field = field;
      m.confidence = "header";
    }
  });

  // Pass 2 — data pattern fallback for still-skip columns
  mappings.forEach((m) => {
    if (m.field !== "skip") return;
    const values = nonEmptyValues(parsed, m.columnName);
    const guess = guessByPattern(values, claimed);
    if (guess) {
      claimed.add(guess);
      m.field = guess;
      m.confidence = "pattern";
    }
  });

  return mappings;
}
