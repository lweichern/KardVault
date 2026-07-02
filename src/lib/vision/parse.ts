import type { ExtractionResult } from "./types";

const GAMES = ["pokemon", "mtg", "yugioh", "riftbound", "unknown"] as const;
const LANGUAGES = ["EN", "JP", "other"] as const;
const CONFIDENCES = ["high", "medium", "low"] as const;

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function asEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : fallback;
}

/**
 * Parse a model response into a validated ExtractionResult. Tolerates markdown
 * fences and stray prose; coerces invalid enums; nulls anything malformed.
 * Throws only when no JSON object can be found at all.
 */
export function parseExtractionJson(text: string): ExtractionResult {
  let cleaned = text
    .replace(/^[\s\S]*?```(?:json)?\s*/i, (m) => (m.includes("{") ? m : ""))
    .replace(/```[\s\S]*$/, "")
    .trim();

  // Fall back to the outermost { ... } block
  if (!cleaned.startsWith("{")) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new Error("No JSON object in extraction response");
    }
    cleaned = text.slice(start, end + 1);
  }

  const raw = JSON.parse(cleaned) as Record<string, unknown>;

  const fragments = Array.isArray(raw.visible_text_fragments)
    ? raw.visible_text_fragments.filter((f): f is string => typeof f === "string")
    : [];

  return {
    game_guess: asEnum(raw.game_guess, GAMES, "unknown"),
    card_name: asString(raw.card_name),
    collector_number: asString(raw.collector_number),
    set_code: asString(raw.set_code),
    set_total: asString(raw.set_total),
    passcode: asString(raw.passcode),
    language: raw.language == null ? null : asEnum(raw.language, LANGUAGES, "other"),
    visible_text_fragments: fragments,
    confidence: asEnum(raw.confidence, CONFIDENCES, "low"),
    is_graded: raw.is_graded === true,
    grading_company: asString(raw.grading_company),
    grade: asString(raw.grade),
    cert_number: asString(raw.cert_number),
  };
}
