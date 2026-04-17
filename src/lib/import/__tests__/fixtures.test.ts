import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseFile } from "../parser";
import { detectColumns } from "../column-detector";

async function loadFixtureAsFile(filename: string): Promise<File> {
  const fullPath = path.join(__dirname, "..", "__fixtures__", filename);
  const buf = await readFile(fullPath);
  return new File([new Uint8Array(buf)], filename, { type: "text/csv" });
}

describe("fixtures — end-to-end auto-detection", () => {
  it("ManaBox export: detects name, set, number, quantity, condition, buy price", async () => {
    const file = await loadFixtureAsFile("manabox.csv");
    const parsed = await parseFile(file);
    const mappings = detectColumns(parsed);
    const byField = Object.fromEntries(mappings.map((m) => [m.field, m.columnName]));
    expect(byField.card_name).toBe("Name");
    expect(byField.set).toBeTruthy();
    expect(byField.card_number).toBe("Collector number");
    expect(byField.quantity).toBe("Quantity");
    expect(byField.condition).toBe("Condition");
    expect(byField.buy_price).toBe("Purchase price");
  });

  it("Dragon Shield export: skips sep=, and detects key fields", async () => {
    const file = await loadFixtureAsFile("dragonshield.csv");
    const parsed = await parseFile(file);
    expect(parsed.headers).toContain("Card Name");
    const mappings = detectColumns(parsed);
    const byField = Object.fromEntries(mappings.map((m) => [m.field, m.columnName]));
    expect(byField.card_name).toBe("Card Name");
    expect(byField.card_number).toBe("Card Number");
    expect(byField.buy_price).toBe("Price Bought");
  });

  it("Deckbox export: detects Count and My Price", async () => {
    const file = await loadFixtureAsFile("deckbox.csv");
    const parsed = await parseFile(file);
    const mappings = detectColumns(parsed);
    const byField = Object.fromEntries(mappings.map((m) => [m.field, m.columnName]));
    expect(byField.card_name).toBe("Name");
    expect(byField.quantity).toBe("Count");
    expect(byField.sell_price).toBe("My Price");
    expect(byField.set).toBe("Edition");
  });

  it("TCGplayer Seller export: detects Product Name and Total Quantity", async () => {
    const file = await loadFixtureAsFile("tcgplayer-seller.csv");
    const parsed = await parseFile(file);
    const mappings = detectColumns(parsed);
    const byField = Object.fromEntries(mappings.map((m) => [m.field, m.columnName]));
    expect(byField.card_name).toBe("Product Name");
    expect(byField.quantity).toBe("Total Quantity");
    expect(byField.sell_price).toBe("TCG Marketplace Price");
  });

  it("Vendor freeform: partially detects, leaves rest as skip", async () => {
    const file = await loadFixtureAsFile("vendor-freeform.csv");
    const parsed = await parseFile(file);
    const mappings = detectColumns(parsed);
    const byField = Object.fromEntries(mappings.map((m) => [m.field, m.columnName]));
    expect(byField.card_name).toBe("card");
    expect(byField.quantity).toBe("qty");
    expect(byField.sell_price).toBe("harga");
    expect(byField.condition).toBe("kondisi");
  });
});
