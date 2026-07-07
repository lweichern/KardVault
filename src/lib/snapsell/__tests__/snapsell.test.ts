import { describe, it, expect } from "vitest";
import {
  tokenize,
  scoreMatch,
  matchSealedProducts,
  buildSealedCatalogIndex,
  type SealedProduct,
} from "../match";
import { parseDetection } from "../detect";

// ── Matcher ─────────────────────────────────────────────────────────────────

const CATALOG: SealedProduct[] = [
  { productId: 1, name: "Surging Sparks Elite Trainer Box", imageUrl: null, groupName: "SV08: Surging Sparks" },
  { productId: 2, name: "Surging Sparks Booster Box", imageUrl: null, groupName: "SV08: Surging Sparks" },
  { productId: 3, name: "Surging Sparks Booster Bundle", imageUrl: null, groupName: "SV08: Surging Sparks" },
  { productId: 4, name: "Prismatic Evolutions Elite Trainer Box", imageUrl: null, groupName: "SV: Prismatic Evolutions" },
  { productId: 5, name: "Terastal Festival ex Booster Box [Japanese]", imageUrl: null, groupName: "SV8a" },
  { productId: 6, name: "151 Ultra Premium Collection", imageUrl: null, groupName: "SV: 151" },
];
const INDEX = buildSealedCatalogIndex(CATALOG);

describe("matchSealedProducts", () => {
  it("picks the exact product type among same-set variants", () => {
    const matches = matchSealedProducts("Surging Sparks Elite Trainer Box", INDEX);
    expect(matches[0].product.productId).toBe(1);
  });

  it("does not confuse booster box with booster bundle", () => {
    const matches = matchSealedProducts("Surging Sparks Booster Box", INDEX);
    expect(matches[0].product.productId).toBe(2);
    const bundle = matchSealedProducts("Surging Sparks Booster Bundle", INDEX);
    expect(bundle[0].product.productId).toBe(3);
  });

  it("respects language — Japanese label prefers the JP product", () => {
    const matches = matchSealedProducts("Japanese Terastal Festival Booster Box", INDEX);
    expect(matches[0].product.productId).toBe(5);
  });

  it("EN label does not silently match a JP product", () => {
    const matches = matchSealedProducts("Terastal Festival Booster Box", INDEX);
    // JP product may appear but heavily discounted
    if (matches.length > 0 && matches[0].product.productId === 5) {
      expect(matches[0].score).toBeLessThan(0.5);
    }
  });

  it("matches premium collections", () => {
    const matches = matchSealedProducts("Pokemon 151 Ultra Premium Collection", INDEX);
    expect(matches[0].product.productId).toBe(6);
  });

  it("returns empty for garbage", () => {
    expect(matchSealedProducts("random household object", INDEX)).toEqual([]);
  });

  it("prefers the plain variant over Case/Exclusive variants", () => {
    const cat = buildSealedCatalogIndex([
      { productId: 10, name: "Surging Sparks Elite Trainer Box", imageUrl: null, groupName: "SV08: Surging Sparks" },
      { productId: 11, name: "Surging Sparks Elite Trainer Box Case", imageUrl: null, groupName: "SV08: Surging Sparks" },
      { productId: 12, name: "Surging Sparks Pokemon Center Elite Trainer Box (Exclusive)", imageUrl: null, groupName: "SV08: Surging Sparks" },
    ]);
    const m = matchSealedProducts("Surging Sparks Elite Trainer Box", cat);
    expect(m[0].product.productId).toBe(10);
    expect(m[0].score).toBeGreaterThan(m[1].score);
  });

  it("weights set-specific tokens above series tokens (IDF)", () => {
    const cat = buildSealedCatalogIndex([
      { productId: 20, name: "Scarlet & Violet Booster Bundle", imageUrl: null, groupName: "SV01: Scarlet & Violet Base Set" },
      { productId: 21, name: "Surging Sparks Booster Bundle (LGS)", imageUrl: null, groupName: "SV08: Surging Sparks" },
      // series words appear across many products → low IDF
      { productId: 22, name: "Scarlet & Violet Paldea Evolved Booster Box", imageUrl: null, groupName: "SV02: Paldea Evolved" },
      { productId: 23, name: "Scarlet & Violet Obsidian Flames Booster Box", imageUrl: null, groupName: "SV03: Obsidian Flames" },
      { productId: 24, name: "Scarlet & Violet Paradox Rift Booster Box", imageUrl: null, groupName: "SV04: Paradox Rift" },
    ]);
    const m = matchSealedProducts("Scarlet & Violet Surging Sparks Booster Bundle", cat);
    expect(m[0].product.productId).toBe(21);
  });

  it("returns at most k candidates sorted by score", () => {
    const matches = matchSealedProducts("Surging Sparks booster", INDEX, 2);
    expect(matches.length).toBeLessThanOrEqual(2);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i].score).toBeLessThanOrEqual(matches[i - 1].score);
    }
  });
});

describe("tokenize / scoreMatch", () => {
  it("normalizes accents and punctuation", () => {
    expect(tokenize("Pokémon: Surging-Sparks!")).toEqual(["pokemon", "surging", "sparks"]);
  });

  it("scores identical token sets near 1", () => {
    const t = tokenize("Surging Sparks Booster Box");
    expect(scoreMatch(t, t)).toBeGreaterThan(0.8);
  });

  it("scores disjoint sets at 0", () => {
    expect(scoreMatch(tokenize("abc def"), tokenize("xyz uvw"))).toBe(0);
  });
});

// ── Detection parser ────────────────────────────────────────────────────────

describe("parseDetection", () => {
  it("parses a clean array", () => {
    const items = parseDetection(
      JSON.stringify([
        { box_2d: [100, 200, 500, 600], label: "Surging Sparks ETB" },
        { box_2d: [0, 0, 1000, 1000], label: "Booster Box" },
      ])
    );
    expect(items).toHaveLength(2);
    expect(items[0].box).toEqual({ x: 0.2, y: 0.1, w: 0.4, h: 0.4 });
    expect(items[0].label).toBe("Surging Sparks ETB");
  });

  it("parses fenced output with prose", () => {
    const items = parseDetection(
      'Here you go:\n```json\n[{"box_2d":[10,10,900,900],"label":"Tin"}]\n```'
    );
    expect(items).toHaveLength(1);
  });

  it("drops malformed boxes and clamps out-of-range values", () => {
    const items = parseDetection(
      JSON.stringify([
        { box_2d: [500, 500, 100, 100], label: "inverted" },
        { box_2d: [0, 0, 1500, 1200], label: "oversized" },
        { box_2d: [0, 0, 100], label: "short" },
        { label: "no box" },
      ])
    );
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe("oversized");
    expect(items[0].box.w).toBeCloseTo(1, 5);
  });

  it("returns [] on garbage and empty arrays", () => {
    expect(parseDetection("I could not find any products.")).toEqual([]);
    expect(parseDetection("[]")).toEqual([]);
    expect(parseDetection("{not json")).toEqual([]);
  });
});
