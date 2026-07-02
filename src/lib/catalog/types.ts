// Pluggable multi-game catalog architecture (CLAUDE-enhance.md §6).
// The identification waterfall is game-agnostic; providers own data ingestion
// rules, identifier crop regions, OCR parsing, and deterministic lookup.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type Game = "pokemon" | "mtg" | "yugioh" | "riftbound";

export type Card = Database["public"]["Tables"]["cards"]["Row"];

/** A crop region expressed as fractions (0..1) of the canonical warped card. */
export interface CropSpec {
  key: "identifier" | "art";
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Identifier fields parsed from OCR text. */
export interface ParsedId {
  /** Collector number as printed, leading zeros preserved (e.g. "025", "TG15", "SVP123"). */
  number?: string;
  /** Denominator of "123/198"-style numbers. */
  setTotal?: number;
  /** Set code token when present (e.g. "SV1", "LOB"). */
  setCode?: string;
  /** Yu-Gi-Oh 8-digit passcode. */
  passcode?: string;
  /** The raw OCR text the parse came from. */
  raw: string;
}

export interface FuzzyFields {
  name?: string | null;
  number?: string | null;
  setTotal?: number | null;
}

export interface CatalogProvider {
  game: Game;
  /** Where to crop the warped card for OCR / art hashing. */
  identifierRegions(): CropSpec[];
  /** Per-game regex parse of OCR text. Null when nothing identifier-like is legible. */
  parseIdentifier(ocrText: string): ParsedId | null;
  /** Deterministic catalog lookup for a parsed identifier. */
  lookup(parsed: ParsedId, db: SupabaseClient<Database>): Promise<Card[]>;
  /** Fuzzy lookup for Tier 3 extraction output (name + partial identifiers). */
  fuzzyLookup(fields: FuzzyFields, db: SupabaseClient<Database>): Promise<Card[]>;
}
