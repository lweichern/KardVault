import { describe, it, expect } from "vitest";
import { classifyCandidates, buildMappedFields } from "../matcher";
import type { CardCandidate, ColumnMapping } from "../types";

describe("classifyCandidates", () => {
  it("returns matched when top score is >= 0.7 and clearly leads", () => {
    const cands: CardCandidate[] = [
      { id: "a", name: "Charizard", setName: "Base", cardNumber: "4", imageSmall: null, marketPriceRm: 100, score: 0.9 },
      { id: "b", name: "Charmander", setName: "Base", cardNumber: "46", imageSmall: null, marketPriceRm: 10, score: 0.4 },
    ];
    expect(classifyCandidates(cands)).toBe("matched");
  });

  it("returns uncertain when top score is in [0.4, 0.7)", () => {
    const cands: CardCandidate[] = [
      { id: "a", name: "Charmeleon", setName: "Base", cardNumber: "24", imageSmall: null, marketPriceRm: 5, score: 0.55 },
    ];
    expect(classifyCandidates(cands)).toBe("uncertain");
  });

  it("returns uncertain when top-2 are within 0.05 of each other", () => {
    const cands: CardCandidate[] = [
      { id: "a", name: "A", setName: "s", cardNumber: "1", imageSmall: null, marketPriceRm: 1, score: 0.82 },
      { id: "b", name: "A2", setName: "s", cardNumber: "2", imageSmall: null, marketPriceRm: 1, score: 0.80 },
    ];
    expect(classifyCandidates(cands)).toBe("uncertain");
  });

  it("returns not_found when top score is below 0.4 or list is empty", () => {
    expect(classifyCandidates([])).toBe("not_found");
    expect(
      classifyCandidates([
        { id: "a", name: "X", setName: "s", cardNumber: "1", imageSmall: null, marketPriceRm: 1, score: 0.3 },
      ])
    ).toBe("not_found");
  });
});

describe("buildMappedFields", () => {
  const mapping: ColumnMapping[] = [
    { columnName: "Name", field: "card_name", confidence: "header", sampleValues: [] },
    { columnName: "Condition", field: "condition", confidence: "header", sampleValues: [] },
    { columnName: "Qty", field: "quantity", confidence: "header", sampleValues: [] },
    { columnName: "Sell", field: "sell_price", confidence: "header", sampleValues: [] },
    { columnName: "Buy", field: "buy_price", confidence: "header", sampleValues: [] },
    { columnName: "Grade", field: "grading", confidence: "header", sampleValues: [] },
  ];

  it("parses a full row", () => {
    const fields = buildMappedFields(
      { Name: "Charizard", Condition: "Near Mint", Qty: "2", Sell: "150.50", Buy: "120", Grade: "PSA 10" },
      mapping,
      "NM"
    );
    expect(fields.condition).toBe("NM");
    expect(fields.quantity).toBe(2);
    expect(fields.sellPriceRm).toBe(150.5);
    expect(fields.buyPriceRm).toBe(120);
    expect(fields.gradingCompany).toBe("PSA");
    expect(fields.grade).toBe("10");
  });

  it("falls back to the default condition when none matches", () => {
    const fields = buildMappedFields({ Name: "x", Condition: "wtf" }, mapping, "LP");
    expect(fields.condition).toBe("LP");
  });

  it("defaults quantity to 1 when missing", () => {
    const fields = buildMappedFields({ Name: "x" }, mapping, "NM");
    expect(fields.quantity).toBe(1);
  });

  it("returns null prices when missing or unparseable", () => {
    const fields = buildMappedFields({ Name: "x", Sell: "abc" }, mapping, "NM");
    expect(fields.sellPriceRm).toBeNull();
    expect(fields.buyPriceRm).toBeNull();
  });

  it("returns null grading when absent", () => {
    const fields = buildMappedFields({ Name: "x" }, mapping, "NM");
    expect(fields.gradingCompany).toBeNull();
    expect(fields.grade).toBeNull();
  });
});
