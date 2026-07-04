import { describe, it, expect, vi } from "vitest";
import { runWaterfall, T_ACCEPT, T_MARGIN } from "../waterfall";
import type { ScanInput, WaterfallDeps } from "../waterfall";
import type { HashHit } from "../hash-index";
import type { Card, CatalogProvider, ParsedId } from "@/lib/catalog";
import type { ExtractionResult } from "@/lib/vision/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// ── Fixtures ────────────────────────────────────────────────────────────────

function card(id: string, number = "25", name = "Pikachu"): Card {
  return { id, name, number, set_name: "Test Set", image_small: null } as unknown as Card;
}

const CHARIZARD = card("sv3-125", "125", "Charizard ex");
const PIKACHU = card("sv1-25", "25", "Pikachu");
const MEW = card("sv2-151", "151", "Mew ex");

const ALL_CARDS: Record<string, Card> = {
  [CHARIZARD.id]: CHARIZARD,
  [PIKACHU.id]: PIKACHU,
  [MEW.id]: MEW,
};

const baseExtraction: ExtractionResult = {
  game_guess: "pokemon",
  card_name: null,
  collector_number: null,
  set_code: null,
  set_total: null,
  passcode: null,
  language: "EN",
  visible_text_fragments: [],
  confidence: "low",
  is_graded: false,
  grading_company: null,
  grade: null,
  cert_number: null,
};

function fakeCatalog(overrides: Partial<CatalogProvider> = {}): CatalogProvider {
  return {
    game: "pokemon",
    identifierRegions: () => [
      { key: "identifier", x: 0, y: 0.88, w: 1, h: 0.12 },
      { key: "art", x: 0.09, y: 0.11, w: 0.82, h: 0.36 },
    ],
    parseIdentifier: (text: string): ParsedId | null => {
      const m = text.match(/(\d{1,3})\s*\/\s*(\d{1,3})/);
      return m ? { number: m[1], setTotal: parseInt(m[2], 10), raw: text } : null;
    },
    lookup: async () => [],
    fuzzyLookup: async () => [],
    ...overrides,
  };
}

function makeDeps(overrides: Partial<WaterfallDeps> = {}): WaterfallDeps {
  return {
    catalog: fakeCatalog(),
    db: {} as SupabaseClient<Database>,
    hashSearch: null,
    ocr: null,
    vision: null,
    getCardsByIds: async (ids: string[]) =>
      ids.map((id) => ALL_CARDS[id]).filter((c): c is Card => !!c),
    ...overrides,
  };
}

function hashHits(...hits: Array<[string, number, number | null]>): HashHit[] {
  return hits.map(([cardId, distance, artDistance]) => ({ cardId, distance, artDistance }));
}

const input: ScanInput = {
  imageFull: "full-b64",
  imageStrip: "strip-b64",
  hashFull: "0123456789abcdef",
  hashArt: "fedcba9876543210",
};

// ── Tier 1 ──────────────────────────────────────────────────────────────────

describe("Tier 1 — perceptual hash", () => {
  it("auto-accepts a clean hash match within thresholds", async () => {
    const deps = makeDeps({
      hashSearch: async () => hashHits([CHARIZARD.id, 4, 6], [PIKACHU.id, 22, 30]),
    });
    const result = await runWaterfall(input, deps);
    expect(result.autoAccepted).toBe(true);
    expect(result.tierResolved).toBe(1);
    expect(result.card?.id).toBe(CHARIZARD.id);
    expect(result.telemetry.hashBestDistance).toBe(4);
    expect(result.telemetry.hashMargin).toBe(18);
    expect(result.telemetry.geminiCalled).toBe(false);
  });

  it("rejects when the margin is too small, carrying priors to later tiers", async () => {
    const deps = makeDeps({
      hashSearch: async () =>
        hashHits([CHARIZARD.id, 8, 5], [PIKACHU.id, 8 + T_MARGIN - 1, 9]),
    });
    const result = await runWaterfall(input, deps);
    expect(result.autoAccepted).toBe(false);
    expect(result.tierResolved).toBe(4);
    // Both hash candidates surface in the confirm UI
    expect(result.candidates.map((c) => c.id)).toContain(CHARIZARD.id);
    expect(result.candidates.map((c) => c.id)).toContain(PIKACHU.id);
    // Best suggestion still exposed, but NOT auto-accepted
    expect(result.card?.id).toBe(CHARIZARD.id);
  });

  it("rejects when distance exceeds T_ACCEPT", async () => {
    const deps = makeDeps({
      hashSearch: async () => hashHits([CHARIZARD.id, T_ACCEPT + 1, 4], [PIKACHU.id, 40, null]),
    });
    const result = await runWaterfall(input, deps);
    expect(result.autoAccepted).toBe(false);
  });

  it("rejects when the art hash disagrees", async () => {
    const deps = makeDeps({
      hashSearch: async () => hashHits([CHARIZARD.id, 4, 30], [PIKACHU.id, 25, null]),
    });
    const result = await runWaterfall(input, deps);
    expect(result.autoAccepted).toBe(false);
  });

  it("skips Tier 1 when no hash was provided", async () => {
    const hashSearch = vi.fn();
    const deps = makeDeps({ hashSearch });
    const result = await runWaterfall({ imageFull: "x" }, deps);
    expect(hashSearch).not.toHaveBeenCalled();
    expect(result.tierResolved).toBeNull();
    expect(result.candidates).toEqual([]);
  });
});

// ── Tier 2 ──────────────────────────────────────────────────────────────────

describe("Tier 2 — OCR strip lookup", () => {
  it("auto-accepts when Tier 1 top and OCR lookup agree", async () => {
    const deps = makeDeps({
      hashSearch: async () => hashHits([CHARIZARD.id, 12, 8], [MEW.id, 14, 9]),
      ocr: { name: "fake", readText: async () => "125/197" },
      catalog: fakeCatalog({ lookup: async () => [CHARIZARD, MEW] }),
    });
    const result = await runWaterfall(input, deps);
    expect(result.autoAccepted).toBe(true);
    expect(result.tierResolved).toBe(2);
    expect(result.card?.id).toBe(CHARIZARD.id);
    expect(result.telemetry.ocrParsed).toBe(true);
  });

  it("auto-accepts a unique OCR match when Tier 1 was unavailable", async () => {
    const deps = makeDeps({
      ocr: { name: "fake", readText: async () => "025/198" },
      catalog: fakeCatalog({ lookup: async () => [PIKACHU] }),
    });
    const result = await runWaterfall({ imageFull: "x", imageStrip: "y" }, deps);
    expect(result.autoAccepted).toBe(true);
    expect(result.tierResolved).toBe(2);
    expect(result.card?.id).toBe(PIKACHU.id);
  });

  it("does NOT auto-accept an ambiguous OCR match without hash agreement", async () => {
    const deps = makeDeps({
      ocr: { name: "fake", readText: async () => "025/198" },
      catalog: fakeCatalog({ lookup: async () => [PIKACHU, MEW] }),
    });
    const result = await runWaterfall({ imageFull: "x", imageStrip: "y" }, deps);
    expect(result.autoAccepted).toBe(false);
    expect(result.tierResolved).toBe(4);
    expect(result.candidates.map((c) => c.id)).toEqual([PIKACHU.id, MEW.id]);
  });

  it("falls through when OCR text parses to nothing", async () => {
    const lookup = vi.fn();
    const deps = makeDeps({
      ocr: { name: "fake", readText: async () => "Illus. Arita" },
      catalog: fakeCatalog({ lookup }),
    });
    const result = await runWaterfall({ imageFull: "x", imageStrip: "y" }, deps);
    expect(lookup).not.toHaveBeenCalled();
    expect(result.telemetry.ocrParsed).toBe(false);
    expect(result.autoAccepted).toBe(false);
  });

  it("skips Tier 2 when no OCR provider is configured", async () => {
    const result = await runWaterfall({ imageFull: "x", imageStrip: "y" }, makeDeps());
    expect(result.telemetry.ocrParsed).toBe(false);
  });
});

// ── Tier 3 ──────────────────────────────────────────────────────────────────

describe("Tier 3 — structured extraction", () => {
  it("auto-accepts on name + number signal agreement", async () => {
    const deps = makeDeps({
      vision: {
        name: "fake-gemini",
        extract: async () => ({
          ...baseExtraction,
          card_name: "Charizard ex",
          collector_number: "125/197",
          confidence: "high",
        }),
      },
      catalog: fakeCatalog({ fuzzyLookup: async () => [CHARIZARD, MEW] }),
    });
    const result = await runWaterfall({ imageFull: "x", imageStrip: "y" }, deps);
    expect(result.autoAccepted).toBe(true);
    expect(result.tierResolved).toBe(3);
    expect(result.card?.id).toBe(CHARIZARD.id);
    expect(result.telemetry.geminiCalled).toBe(true);
  });

  it("auto-accepts on name + hash-prior agreement", async () => {
    const deps = makeDeps({
      hashSearch: async () => hashHits([CHARIZARD.id, 14, 10], [MEW.id, 15, 12]),
      vision: {
        name: "fake-gemini",
        extract: async () => ({ ...baseExtraction, card_name: "Charizard ex" }),
      },
      catalog: fakeCatalog({ fuzzyLookup: async () => [CHARIZARD] }),
    });
    const result = await runWaterfall(input, deps);
    expect(result.autoAccepted).toBe(true);
    expect(result.tierResolved).toBe(3);
  });

  it("does NOT auto-accept on a single signal (name only)", async () => {
    const deps = makeDeps({
      vision: {
        name: "fake-gemini",
        extract: async () => ({ ...baseExtraction, card_name: "Charizard", confidence: "high" }),
      },
      catalog: fakeCatalog({ fuzzyLookup: async () => [CHARIZARD, MEW] }),
    });
    const result = await runWaterfall({ imageFull: "x" }, deps);
    expect(result.autoAccepted).toBe(false);
    expect(result.tierResolved).toBe(4);
    // Suggestions still shown in confirm UI
    expect(result.candidates[0].id).toBe(CHARIZARD.id);
  });

  it("sends both crops to the vision provider", async () => {
    const extract = vi.fn().mockResolvedValue(baseExtraction);
    const deps = makeDeps({ vision: { name: "fake", extract } });
    await runWaterfall(input, deps);
    expect(extract).toHaveBeenCalledWith(["full-b64", "strip-b64"]);
  });

  it("survives a vision provider crash", async () => {
    const deps = makeDeps({
      vision: {
        name: "fake",
        extract: async () => {
          throw new Error("rate limited");
        },
      },
    });
    const result = await runWaterfall({ imageFull: "x" }, deps);
    expect(result.autoAccepted).toBe(false);
    expect(result.card).toBeNull();
    expect(result.telemetry.geminiCalled).toBe(true);
  });
});

// ── Reprint-cluster shortcut ────────────────────────────────────────────────

describe("same-art reprint cluster shortcut", () => {
  it("skips Gemini and returns candidates instantly when hash finds a tight cluster and OCR is unavailable", async () => {
    const extract = vi.fn();
    const deps = makeDeps({
      hashSearch: async () => hashHits([CHARIZARD.id, 8, 6], [MEW.id, 10, 8]),
      vision: { name: "fake-gemini", extract },
    });
    const result = await runWaterfall(input, deps);
    expect(extract).not.toHaveBeenCalled();
    expect(result.telemetry.geminiCalled).toBe(false);
    expect(result.autoAccepted).toBe(false);
    expect(result.tierResolved).toBe(4);
    expect(result.candidates.map((c) => c.id)).toEqual([CHARIZARD.id, MEW.id]);
    expect(result.card?.id).toBe(CHARIZARD.id);
  });

  it("still calls Gemini when the hash match is weak (no cluster)", async () => {
    const extract = vi.fn().mockResolvedValue(baseExtraction);
    const deps = makeDeps({
      hashSearch: async () => hashHits([CHARIZARD.id, 20, 18], [MEW.id, 25, 22]),
      vision: { name: "fake-gemini", extract },
    });
    const result = await runWaterfall(input, deps);
    expect(extract).toHaveBeenCalled();
    expect(result.telemetry.geminiCalled).toBe(true);
  });

  it("lets OCR resolve the cluster instead when it parses an identifier", async () => {
    const extract = vi.fn();
    const deps = makeDeps({
      hashSearch: async () => hashHits([CHARIZARD.id, 8, 6], [MEW.id, 10, 8]),
      ocr: { name: "fake", readText: async () => "125/197" },
      catalog: fakeCatalog({ lookup: async () => [CHARIZARD, MEW] }),
      vision: { name: "fake-gemini", extract },
    });
    const result = await runWaterfall(input, deps);
    // Tier 1 top + OCR top agree → auto-accept at Tier 2, no Gemini
    expect(result.autoAccepted).toBe(true);
    expect(result.tierResolved).toBe(2);
    expect(extract).not.toHaveBeenCalled();
  });
});

// ── Candidate assembly ──────────────────────────────────────────────────────

describe("candidate assembly", () => {
  it("dedupes and caps candidates at 3", async () => {
    const deps = makeDeps({
      hashSearch: async () =>
        hashHits([CHARIZARD.id, 12, 8], [PIKACHU.id, 13, 9], [MEW.id, 14, 10]),
      ocr: { name: "fake", readText: async () => "125/197" },
      catalog: fakeCatalog({
        lookup: async () => [CHARIZARD, PIKACHU],
        fuzzyLookup: async () => [CHARIZARD, MEW],
      }),
      vision: {
        name: "fake",
        extract: async () => ({ ...baseExtraction, collector_number: "125/197" }),
      },
    });
    const result = await runWaterfall(input, deps);
    const ids = result.candidates.map((c) => c.id);
    expect(ids.length).toBeLessThanOrEqual(3);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns empty-handed gracefully when every tier is disabled", async () => {
    const result = await runWaterfall({ imageFull: "x" }, makeDeps());
    expect(result).toMatchObject({
      card: null,
      candidates: [],
      autoAccepted: false,
      tierResolved: null,
    });
  });
});
