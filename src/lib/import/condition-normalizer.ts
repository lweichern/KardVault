type Canonical = "NM" | "LP" | "MP" | "HP" | "DMG";

const RULES: Array<[string, Canonical]> = [
  ["nearmint", "NM"],
  ["lightlyplayed", "LP"],
  ["moderatelyplayed", "MP"],
  ["heavilyplayed", "HP"],
  ["damaged", "DMG"],
  ["played", "MP"],
  ["mint", "NM"],
  ["nm", "NM"],
  ["lp", "LP"],
  ["mp", "MP"],
  ["hp", "HP"],
  ["dmg", "DMG"],
];

export function normalizeCondition(input: string | null | undefined): Canonical | null {
  if (!input) return null;
  const cleaned = input.toLowerCase().replace(/[^a-z]/g, "");
  if (!cleaned) return null;
  for (const [token, canonical] of RULES) {
    if (cleaned.includes(token)) return canonical;
  }
  return null;
}
