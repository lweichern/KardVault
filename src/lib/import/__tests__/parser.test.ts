import { describe, it, expect } from "vitest";
import { parseFile, MAX_FILE_BYTES, MAX_ROWS } from "../parser";

function makeFile(content: string, name = "test.csv", type = "text/csv"): File {
  return new File([content], name, { type });
}

describe("parseFile", () => {
  it("parses a simple CSV with header", async () => {
    const file = makeFile("name,qty\nCharizard,2\nPikachu,5");
    const result = await parseFile(file);
    expect(result.headers).toEqual(["name", "qty"]);
    expect(result.rowCount).toBe(2);
    expect(result.rows[0]).toEqual({ name: "Charizard", qty: "2" });
  });

  it("skips the Dragon Shield sep=, prefix row", async () => {
    const file = makeFile("sep=,\nName,Quantity\nCharizard,1");
    const result = await parseFile(file);
    expect(result.headers).toEqual(["Name", "Quantity"]);
    expect(result.rows[0]).toEqual({ Name: "Charizard", Quantity: "1" });
  });

  it("strips UTF-8 BOM", async () => {
    const file = makeFile("\uFEFFname,qty\nCharizard,1");
    const result = await parseFile(file);
    expect(result.headers).toEqual(["name", "qty"]);
  });

  it("trims header whitespace", async () => {
    const file = makeFile("  name  ,  qty  \nCharizard,1");
    const result = await parseFile(file);
    expect(result.headers).toEqual(["name", "qty"]);
  });

  it("rejects files over MAX_FILE_BYTES", async () => {
    const huge = new File([new Uint8Array(MAX_FILE_BYTES + 1)], "huge.csv", {
      type: "text/csv",
    });
    await expect(parseFile(huge)).rejects.toThrow(/too large/i);
  });

  it("rejects non-csv/xlsx files", async () => {
    const file = makeFile("blah", "data.txt", "text/plain");
    await expect(parseFile(file)).rejects.toThrow(/csv.*excel/i);
  });

  it("rejects empty files", async () => {
    const file = makeFile("");
    await expect(parseFile(file)).rejects.toThrow(/couldn't find any data/i);
  });

  it("rejects files with more than MAX_ROWS data rows", async () => {
    const rows = Array.from({ length: MAX_ROWS + 10 }, (_, i) => `Card${i},1`).join(
      "\n"
    );
    const file = makeFile(`name,qty\n${rows}`);
    await expect(parseFile(file)).rejects.toThrow(/5,000|max/i);
  });
});
