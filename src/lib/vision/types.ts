import type { Database } from "@/types/database";

export type Card = Database["public"]["Tables"]["cards"]["Row"];

/**
 * Tier 3 structured extraction output (CLAUDE-enhance.md §2 Tier 3).
 * The model extracts *text fields* it can read — it never identifies the card.
 * Matching against the catalog is deterministic and happens in the waterfall.
 */
export interface ExtractionResult {
  game_guess: "pokemon" | "mtg" | "yugioh" | "riftbound" | "unknown";
  card_name: string | null;
  collector_number: string | null; // e.g. "123/198", "0057", "LOB-EN005"
  set_code: string | null;
  set_total: string | null;
  passcode: string | null; // yugioh 8-digit, else null
  language: "EN" | "JP" | "other" | null;
  visible_text_fragments: string[];
  confidence: "high" | "medium" | "low";
  // Grading slab support (existing capability, carried over)
  is_graded: boolean;
  grading_company: string | null;
  grade: string | null;
  cert_number: string | null;
}

export interface VisionProvider {
  name: string;
  /** Extract text fields from one or more crops (full card + zoomed identifier strip). */
  extract(imagesBase64: string[]): Promise<ExtractionResult>;
}
