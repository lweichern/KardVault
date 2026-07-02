import { describe, it, expect } from "vitest";
import { PokemonCatalogProvider, numberVariants } from "../pokemon";

const provider = new PokemonCatalogProvider();

describe("PokemonCatalogProvider.parseIdentifier", () => {
  it("parses a standard collector number", () => {
    const parsed = provider.parseIdentifier("123/198 · Scarlet & Violet");
    expect(parsed).toMatchObject({ number: "123", setTotal: 198 });
  });

  it("parses with leading zeros preserved", () => {
    const parsed = provider.parseIdentifier("025/198");
    expect(parsed).toMatchObject({ number: "025", setTotal: 198 });
  });

  it("parses spaced slashes from messy OCR", () => {
    const parsed = provider.parseIdentifier("064 / 198  H");
    expect(parsed).toMatchObject({ number: "064", setTotal: 198 });
  });

  it("parses Trainer Gallery numbers without a numeric total", () => {
    const parsed = provider.parseIdentifier("TG15/TG30");
    expect(parsed).toMatchObject({ number: "TG15" });
    expect(parsed?.setTotal).toBeUndefined();
  });

  it("parses Galarian Gallery numbers", () => {
    const parsed = provider.parseIdentifier("GG56/GG70");
    expect(parsed).toMatchObject({ number: "GG56" });
  });

  it("parses SWSH promo numbers", () => {
    const parsed = provider.parseIdentifier("SWSH 250");
    expect(parsed).toMatchObject({ number: "SWSH250", setCode: "SWSH" });
  });

  it("parses SVP promo numbers case-insensitively", () => {
    const parsed = provider.parseIdentifier("svp-123");
    expect(parsed).toMatchObject({ number: "SVP123" });
  });

  it("returns null for text without identifiers", () => {
    expect(provider.parseIdentifier("Charizard ex HP 330")).toBeNull();
    expect(provider.parseIdentifier("")).toBeNull();
    expect(provider.parseIdentifier("Illus. Mitsuhiro Arita")).toBeNull();
  });
});

describe("numberVariants", () => {
  it("strips leading zeros as a variant", () => {
    expect(numberVariants({ number: "025", raw: "" })).toEqual(["025", "25"]);
  });

  it("keeps prefixed numbers and adds digit-only fallback", () => {
    expect(numberVariants({ number: "SWSH250", raw: "" })).toEqual(["SWSH250", "250"]);
  });

  it("handles TG numbers", () => {
    expect(numberVariants({ number: "TG15", raw: "" })).toEqual(["TG15", "15"]);
  });

  it("returns nothing without a number", () => {
    expect(numberVariants({ raw: "" })).toEqual([]);
  });

  it("dedupes when stripped form equals the original", () => {
    expect(numberVariants({ number: "123", raw: "" })).toEqual(["123"]);
  });
});

describe("identifierRegions", () => {
  it("provides identifier and art crops in fraction space", () => {
    const regions = provider.identifierRegions();
    const keys = regions.map((r) => r.key);
    expect(keys).toContain("identifier");
    expect(keys).toContain("art");
    for (const r of regions) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1);
      expect(r.y + r.h).toBeLessThanOrEqual(1);
    }
  });
});
