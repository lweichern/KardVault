import { describe, it, expect } from "vitest";
import { parseExtractionJson } from "../parse";

const full = {
  game_guess: "pokemon",
  card_name: "Charizard ex",
  collector_number: "125/197",
  set_code: "OBF",
  set_total: "197",
  passcode: null,
  language: "EN",
  visible_text_fragments: ["Illus. 5ban Graphics"],
  confidence: "high",
  is_graded: false,
  grading_company: null,
  grade: null,
  cert_number: null,
};

describe("parseExtractionJson", () => {
  it("parses bare JSON", () => {
    const result = parseExtractionJson(JSON.stringify(full));
    expect(result.card_name).toBe("Charizard ex");
    expect(result.collector_number).toBe("125/197");
    expect(result.confidence).toBe("high");
  });

  it("parses fenced JSON", () => {
    const result = parseExtractionJson("```json\n" + JSON.stringify(full) + "\n```");
    expect(result.card_name).toBe("Charizard ex");
  });

  it("parses JSON with surrounding prose", () => {
    const result = parseExtractionJson(
      "Here is the extraction:\n" + JSON.stringify(full) + "\nHope that helps!"
    );
    expect(result.collector_number).toBe("125/197");
  });

  it("coerces invalid enums to safe fallbacks", () => {
    const result = parseExtractionJson(
      JSON.stringify({ ...full, game_guess: "digimon", confidence: "certain", language: "DE" })
    );
    expect(result.game_guess).toBe("unknown");
    expect(result.confidence).toBe("low");
    expect(result.language).toBe("other");
  });

  it("nulls malformed fields and defaults fragments", () => {
    const result = parseExtractionJson(
      JSON.stringify({ game_guess: "pokemon", card_name: 42, visible_text_fragments: "nope" })
    );
    expect(result.card_name).toBeNull();
    expect(result.visible_text_fragments).toEqual([]);
    expect(result.is_graded).toBe(false);
    expect(result.confidence).toBe("low");
  });

  it("trims whitespace-only strings to null", () => {
    const result = parseExtractionJson(JSON.stringify({ ...full, set_code: "   " }));
    expect(result.set_code).toBeNull();
  });

  it("keeps grading slab fields", () => {
    const result = parseExtractionJson(
      JSON.stringify({
        ...full,
        is_graded: true,
        grading_company: "PSA",
        grade: "10",
        cert_number: "12345678",
      })
    );
    expect(result.is_graded).toBe(true);
    expect(result.grading_company).toBe("PSA");
    expect(result.grade).toBe("10");
  });

  it("throws when no JSON exists", () => {
    expect(() => parseExtractionJson("I cannot read this card.")).toThrow();
  });
});
