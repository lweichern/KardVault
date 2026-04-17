import { describe, it, expect } from "vitest";
import { normalizeCondition } from "../condition-normalizer";

describe("normalizeCondition", () => {
  it.each([
    ["NM", "NM"],
    ["nm", "NM"],
    ["Near Mint", "NM"],
    ["NearMint", "NM"],
    ["near_mint", "NM"],
    ["Mint", "NM"],
    ["LP", "LP"],
    ["Lightly Played", "LP"],
    ["Good (Lightly Played)", "LP"],
    ["lightly_played", "LP"],
    ["MP", "MP"],
    ["Moderately Played", "MP"],
    ["Played", "MP"],
    ["HP", "HP"],
    ["Heavily Played", "HP"],
    ["DMG", "DMG"],
    ["Damaged", "DMG"],
  ])("maps %s to %s", (input, expected) => {
    expect(normalizeCondition(input)).toBe(expected);
  });

  it.each(["", "   ", "unknown", "WTF", null, undefined])(
    "returns null for %s",
    (input) => {
      expect(normalizeCondition(input as string)).toBeNull();
    }
  );
});
