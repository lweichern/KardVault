import { describe, it, expect } from "vitest";
import { detectColumns } from "../column-detector";
import type { ParsedFile } from "../types";

function file(headers: string[], sampleRow: string[] = []): ParsedFile {
  const row: Record<string, string> = {};
  headers.forEach((h, i) => (row[h] = sampleRow[i] ?? ""));
  return {
    headers,
    rows: [row],
    rowCount: 1,
    fileName: "test.csv",
    sizeBytes: 10,
  };
}

describe("detectColumns — header matching", () => {
  it("detects ManaBox headers", () => {
    const parsed = file([
      "Name",
      "Set name",
      "Collector number",
      "Quantity",
      "Condition",
      "Purchase price",
    ]);
    const mappings = detectColumns(parsed);
    const fieldFor = (col: string) =>
      mappings.find((m) => m.columnName === col)?.field;
    expect(fieldFor("Name")).toBe("card_name");
    expect(fieldFor("Set name")).toBe("set");
    expect(fieldFor("Collector number")).toBe("card_number");
    expect(fieldFor("Quantity")).toBe("quantity");
    expect(fieldFor("Condition")).toBe("condition");
    expect(fieldFor("Purchase price")).toBe("buy_price");
  });

  it("detects Dragon Shield headers", () => {
    const parsed = file([
      "Card Name",
      "Set Name",
      "Card Number",
      "Quantity",
      "Condition",
      "Price Bought",
    ]);
    const mappings = detectColumns(parsed);
    const fieldFor = (col: string) =>
      mappings.find((m) => m.columnName === col)?.field;
    expect(fieldFor("Card Name")).toBe("card_name");
    expect(fieldFor("Card Number")).toBe("card_number");
    expect(fieldFor("Price Bought")).toBe("buy_price");
  });

  it("detects Deckbox headers", () => {
    const parsed = file(["Count", "Name", "Edition", "Card Number", "Condition", "My Price"]);
    const mappings = detectColumns(parsed);
    const fieldFor = (col: string) =>
      mappings.find((m) => m.columnName === col)?.field;
    expect(fieldFor("Count")).toBe("quantity");
    expect(fieldFor("Edition")).toBe("set");
    expect(fieldFor("My Price")).toBe("sell_price");
  });

  it("is case- and whitespace-insensitive", () => {
    const parsed = file(["  CARD NAME  ", "card_name"]);
    const mappings = detectColumns(parsed);
    expect(mappings[0].field).toBe("card_name");
    expect(mappings[1].field).toBe("skip");
  });

  it("marks unknown headers as skip with manual confidence", () => {
    const parsed = file(["WeirdColumn"]);
    const mappings = detectColumns(parsed);
    expect(mappings[0].field).toBe("skip");
    expect(mappings[0].confidence).toBe("manual");
  });

  it("returns header confidence for alias matches", () => {
    const parsed = file(["Quantity"]);
    const mappings = detectColumns(parsed);
    expect(mappings[0].confidence).toBe("header");
  });

  it("includes sample values from data rows", () => {
    const parsed: ParsedFile = {
      headers: ["Name"],
      rows: [{ Name: "Charizard" }, { Name: "Pikachu" }, { Name: "Eevee" }, { Name: "Bulbasaur" }],
      rowCount: 4,
      fileName: "t.csv",
      sizeBytes: 10,
    };
    const [nameCol] = detectColumns(parsed);
    expect(nameCol.sampleValues).toEqual(["Charizard", "Pikachu", "Eevee"]);
  });
});

describe("detectColumns — data pattern fallback", () => {
  it("identifies a plain-integer card number column by values", () => {
    const parsed: ParsedFile = {
      headers: ["Mystery"],
      rows: Array.from({ length: 10 }, (_, i) => ({ Mystery: String(i + 1) })),
      rowCount: 10,
      fileName: "t.csv",
      sizeBytes: 10,
    };
    const [mapping] = detectColumns(parsed);
    expect(mapping.field).toBe("card_number");
    expect(mapping.confidence).toBe("pattern");
  });

  it("identifies slash-formatted card numbers", () => {
    const parsed: ParsedFile = {
      headers: ["Whatever"],
      rows: Array.from({ length: 10 }, (_, i) => ({ Whatever: `${i + 1}/198` })),
      rowCount: 10,
      fileName: "t.csv",
      sizeBytes: 10,
    };
    const [mapping] = detectColumns(parsed);
    expect(mapping.field).toBe("card_number");
  });

  it("identifies a condition column by NM/LP/etc values", () => {
    const parsed: ParsedFile = {
      headers: ["Col"],
      rows: [
        { Col: "NM" },
        { Col: "LP" },
        { Col: "Near Mint" },
        { Col: "Damaged" },
        { Col: "NM" },
      ],
      rowCount: 5,
      fileName: "t.csv",
      sizeBytes: 10,
    };
    const [mapping] = detectColumns(parsed);
    expect(mapping.field).toBe("condition");
  });

  it("identifies a grading column via PSA/BGS/CGC values", () => {
    const parsed: ParsedFile = {
      headers: ["Col"],
      rows: [
        { Col: "PSA 10" },
        { Col: "BGS 9.5" },
        { Col: "" },
        { Col: "" },
        { Col: "" },
        { Col: "" },
        { Col: "CGC 9" },
      ],
      rowCount: 7,
      fileName: "t.csv",
      sizeBytes: 10,
    };
    const [mapping] = detectColumns(parsed);
    expect(mapping.field).toBe("grading");
  });

  it("does not override a header-matched field with a pattern guess", () => {
    const parsed: ParsedFile = {
      headers: ["Quantity", "Random"],
      rows: Array.from({ length: 10 }, (_, i) => ({
        Quantity: String(i + 1),
        Random: String(i + 1),
      })),
      rowCount: 10,
      fileName: "t.csv",
      sizeBytes: 10,
    };
    const [q, r] = detectColumns(parsed);
    expect(q.field).toBe("quantity");
    expect(r.field).toBe("card_number");
  });
});
