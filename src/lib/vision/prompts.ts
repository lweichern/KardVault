// Tier 3 extraction prompt (CLAUDE-enhance.md §2 Tier 3): strict JSON,
// extraction only — the model must never guess identifiers or identify cards.

export const EXTRACTION_PROMPT = `You are extracting text fields from a trading card photo. You may receive two images: the full card and a zoomed crop of its identifier text region. Return ONLY valid JSON, no markdown, no explanation. Schema:
{
  "game_guess": "pokemon" | "mtg" | "yugioh" | "riftbound" | "unknown",
  "card_name": string | null,
  "collector_number": string | null,
  "set_code": string | null,
  "set_total": string | null,
  "passcode": string | null,
  "language": "EN" | "JP" | "other" | null,
  "visible_text_fragments": [string],
  "confidence": "high" | "medium" | "low",
  "is_graded": boolean,
  "grading_company": string | null,
  "grade": string | null,
  "cert_number": string | null
}
Field notes:
- collector_number: exactly as printed, e.g. "123/198", "0057", "LOB-EN005".
- set_total: the denominator when the number is printed as "123/198" (here "198").
- passcode: the 8-digit Yu-Gi-Oh passcode, else null.
- visible_text_fragments: any partial legible text not captured above.
- If the card is inside a grading slab (PSA, BGS, CGC, SGC, TAG, ACE): set is_graded true and fill grading_company, grade, cert_number from the slab label.
Use null for anything not clearly legible. Do NOT guess identifiers.`;
