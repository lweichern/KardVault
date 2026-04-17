# CSV/Excel Inventory Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship CSV/Excel inventory import that handles exports from ManaBox, Dragon Shield, Deckbox, TCGplayer, Collectr, Shiny, and hand-rolled vendor spreadsheets. Vendors can migrate an existing collection in under 2 minutes.

**Architecture:** Client-side parser (Papa Parse for CSV, SheetJS for XLSX) → auto-detect column mappings via header aliases + data patterns → server-side fuzzy match via Postgres `match_cards` RPC → preview screen with confidence classification → single atomic batch insert to `inventory`. Three screens connected by sessionStorage (`importId`-keyed state).

**Tech Stack:** Next.js 15 app router, React 19, Supabase (Postgres + auth), Papa Parse 5.x, SheetJS 0.18.x, pg_trgm, Vitest + happy-dom (new — no test infra currently).

**Spec reference:** [`docs/superpowers/specs/2026-04-17-csv-import-design.md`](../specs/2026-04-17-csv-import-design.md)

---

## File Structure

**New files:**
```
src/lib/import/
  types.ts                    # ParsedFile, ColumnMapping, MatchResult, KardVaultField
  parser.ts                   # parseFile(File) — CSV + XLSX entry point
  condition-normalizer.ts     # normalizeCondition(str) → NM|LP|MP|HP|DMG|null
  grading-parser.ts           # parseGrading(str) → {grading_company, grade} | null
  column-detector.ts          # detectColumns(ParsedFile) → ColumnMapping[]
  matcher.ts                  # matchRows(rows, mapping, vendorId) → MatchResult[]

src/app/import/
  layout.tsx                  # shared import flow shell (feature flag check)
  page.tsx                    # upload screen
  mapping/page.tsx            # column mapping screen
  preview/page.tsx            # match preview + final import action

src/components/import/
  upload-dropzone.tsx
  column-mapping-row.tsx
  match-result-row.tsx
  batch-pricing-selector.tsx

public/templates/
  kardvault-template.csv

supabase/migrations/
  00004_import_matching.sql   # match_cards RPC + idempotent trgm index

vitest.config.ts              # NEW — test runner config
vitest.setup.ts               # NEW — test env setup

src/lib/import/__fixtures__/  # synthesized competitor exports for integration tests
  manabox.csv
  dragonshield.csv
  deckbox.csv
  tcgplayer-seller.csv
  vendor-freeform.csv

src/lib/import/__tests__/
  parser.test.ts
  condition-normalizer.test.ts
  grading-parser.test.ts
  column-detector.test.ts
  fixtures.test.ts            # integration: fixture file → end-to-end mapping + normalization
```

**Modified files:**
- [`package.json`](../../../package.json) — add papaparse, xlsx, vitest, test scripts
- [`src/app/(vendor)/inventory/page.tsx`](../../../src/app/(vendor)/inventory/page.tsx) — add "Import CSV" button linking to `/import`
- [`.env.local`](../../../.env.local) and `.env.example` — `NEXT_PUBLIC_CSV_IMPORT_ENABLED`

---

## Task 0: Set up Vitest

The project has zero test infrastructure. Install Vitest + happy-dom (lighter than jsdom, works with Next 16) and verify it runs.

**Files:**
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Create: `src/lib/__tests__/sanity.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Install dev dependencies**

```bash
npm install --save-dev vitest @vitest/ui happy-dom
```

- [ ] **Step 2: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 3: Create `vitest.setup.ts`**

```typescript
import { afterEach } from "vitest";

afterEach(() => {
  if (typeof sessionStorage !== "undefined") sessionStorage.clear();
  if (typeof localStorage !== "undefined") localStorage.clear();
});
```

- [ ] **Step 4: Add test scripts to `package.json`**

In the `"scripts"` section, add:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:ui": "vitest --ui"
```

- [ ] **Step 5: Write a sanity test at `src/lib/__tests__/sanity.test.ts`**

```typescript
import { describe, it, expect } from "vitest";

describe("sanity", () => {
  it("happy-dom provides sessionStorage", () => {
    sessionStorage.setItem("k", "v");
    expect(sessionStorage.getItem("k")).toBe("v");
  });
});
```

- [ ] **Step 6: Run and verify**

```bash
npm test
```

Expected: 1 passed, exits 0.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts vitest.setup.ts src/lib/__tests__/sanity.test.ts package.json package-lock.json
git commit -m "chore: set up vitest with happy-dom"
```

---

## Task 1: Install CSV/Excel parsing dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime deps**

```bash
npm install papaparse xlsx
npm install --save-dev @types/papaparse
```

Note: `xlsx` ships its own types so no `@types/xlsx` is needed.

- [ ] **Step 2: Verify install**

```bash
node -e "console.log(require('papaparse').parse('a,b\n1,2', {header: true}).data)"
```

Expected: `[ { a: '1', b: '2' } ]`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add papaparse and xlsx for CSV import"
```

---

## Task 2: Shared types for import pipeline

Define the types every other module consumes. Keep this file imports-only — no runtime code.

**Files:**
- Create: `src/lib/import/types.ts`

- [ ] **Step 1: Write `src/lib/import/types.ts`**

```typescript
export type KardVaultField =
  | "card_name"
  | "set"
  | "card_number"
  | "sell_price"
  | "buy_price"
  | "condition"
  | "quantity"
  | "grading";

export type ParsedFile = {
  headers: string[];
  rows: Record<string, string>[];
  rowCount: number;
  fileName: string;
  sizeBytes: number;
};

export type ColumnMapping = {
  columnName: string;
  field: KardVaultField | "skip";
  confidence: "header" | "pattern" | "manual";
  sampleValues: string[];
};

export type MatchResult = {
  rowIndex: number;
  rawCardName: string;
  status: "matched" | "uncertain" | "not_found";
  candidates: CardCandidate[];
  selectedCardId: string | null;
  mappedFields: {
    sellPriceRm: number | null;
    buyPriceRm: number | null;
    condition: "NM" | "LP" | "MP" | "HP" | "DMG";
    quantity: number;
    gradingCompany: string | null;
    grade: string | null;
  };
};

export type CardCandidate = {
  id: string;
  name: string;
  setName: string;
  cardNumber: string;
  imageSmall: string | null;
  marketPriceRm: number | null;
  score: number;
};

export type ImportSessionState = {
  importId: string;
  parsedFile: ParsedFile;
  mappings: ColumnMapping[];
  matchResults: MatchResult[];
  batchPricingRule: "market" | "0.9" | "0.8" | number;
  createdAt: number;
};

export const FIELD_LABELS: Record<KardVaultField, string> = {
  card_name: "Card name",
  set: "Set",
  card_number: "Card number",
  sell_price: "Sell price",
  buy_price: "Buy price",
  condition: "Condition",
  quantity: "Quantity",
  grading: "Grading",
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/import/types.ts
git commit -m "feat(import): shared types for CSV import pipeline"
```

---

## Task 3: Condition normalizer

Converts freeform condition strings from any competitor export into the canonical `NM|LP|MP|HP|DMG`. Return `null` for unrecognized values so callers can fall back to a default.

**Files:**
- Create: `src/lib/import/condition-normalizer.ts`
- Create: `src/lib/import/__tests__/condition-normalizer.test.ts`

- [ ] **Step 1: Write the failing test at `src/lib/import/__tests__/condition-normalizer.test.ts`**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- condition-normalizer
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/import/condition-normalizer.ts`**

```typescript
type Canonical = "NM" | "LP" | "MP" | "HP" | "DMG";

const RULES: Array<[string, Canonical]> = [
  // Longer/more-specific tokens first — substring search picks the first match
  ["nearmint", "NM"],
  ["lightlyplayed", "LP"],
  ["moderatelyplayed", "MP"],
  ["heavilyplayed", "HP"],
  ["damaged", "DMG"],
  ["played", "MP"], // must come after the specific variants
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- condition-normalizer
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/import/condition-normalizer.ts src/lib/import/__tests__/condition-normalizer.test.ts
git commit -m "feat(import): condition normalizer with canonical NM/LP/MP/HP/DMG"
```

---

## Task 4: Grading parser

Parses strings like `PSA 10`, `BGS 9.5`, `CGC 9`, `ACE 10`, `SGC 8.5` into `{grading_company, grade}`. Empty or non-matching input returns `null` (row is treated as raw).

**Files:**
- Create: `src/lib/import/grading-parser.ts`
- Create: `src/lib/import/__tests__/grading-parser.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { parseGrading } from "../grading-parser";

describe("parseGrading", () => {
  it.each([
    ["PSA 10", { gradingCompany: "PSA", grade: "10" }],
    ["psa10", { gradingCompany: "PSA", grade: "10" }],
    ["BGS 9.5", { gradingCompany: "BGS", grade: "9.5" }],
    ["CGC 9", { gradingCompany: "CGC", grade: "9" }],
    ["ACE 10", { gradingCompany: "ACE", grade: "10" }],
    ["SGC 8.5", { gradingCompany: "SGC", grade: "8.5" }],
    ["  PSA   10  ", { gradingCompany: "PSA", grade: "10" }],
  ])("parses %s", (input, expected) => {
    expect(parseGrading(input)).toEqual(expected);
  });

  it.each(["", "   ", "raw", "Charizard PSA 10", "PSA", "10", null, undefined])(
    "returns null for %s",
    (input) => {
      expect(parseGrading(input as string)).toBeNull();
    }
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- grading-parser
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/import/grading-parser.ts`**

```typescript
const PATTERN = /^\s*(PSA|BGS|CGC|ACE|SGC)\s*(\d+(?:\.\d+)?)\s*$/i;

export type Grading = {
  gradingCompany: string;
  grade: string;
};

export function parseGrading(input: string | null | undefined): Grading | null {
  if (!input) return null;
  const match = input.match(PATTERN);
  if (!match) return null;
  return {
    gradingCompany: match[1].toUpperCase(),
    grade: match[2],
  };
}
```

- [ ] **Step 4: Run test**

```bash
npm test -- grading-parser
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/import/grading-parser.ts src/lib/import/__tests__/grading-parser.test.ts
git commit -m "feat(import): grading parser for PSA/BGS/CGC/ACE/SGC"
```

---

## Task 5: CSV + XLSX parser

Reads a `File` (browser API) and returns a `ParsedFile`. Handles Dragon Shield's `sep=,` prefix row, UTF-8 BOM, and both CSV and XLSX formats. Rejects on 5 MB size cap and 5,000 row cap.

**Files:**
- Create: `src/lib/import/parser.ts`
- Create: `src/lib/import/__tests__/parser.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { parseFile, MAX_FILE_BYTES, MAX_ROWS } from "../parser";

function makeFile(content: string, name = "test.csv", type = "text/csv"): File {
  return new File([content], name, { type });
}

function makeBinaryFile(bytes: ArrayBuffer, name: string, type: string): File {
  return new File([bytes], name, { type });
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
    const file = makeFile('sep=,\nName,Quantity\nCharizard,1');
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
    await expect(parseFile(file)).rejects.toThrow(/empty|no data/i);
  });

  it("rejects files with more than MAX_ROWS data rows", async () => {
    const rows = Array.from({ length: MAX_ROWS + 10 }, (_, i) => `Card${i},1`).join(
      "\n"
    );
    const file = makeFile(`name,qty\n${rows}`);
    await expect(parseFile(file)).rejects.toThrow(/5,000|max/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- parser
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/import/parser.ts`**

```typescript
import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { ParsedFile } from "./types";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 5_000;

const CSV_EXTENSIONS = [".csv"];
const XLSX_EXTENSIONS = [".xlsx"];

export async function parseFile(file: File): Promise<ParsedFile> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `File too large — max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB. Split your file into smaller batches.`
    );
  }
  const name = file.name.toLowerCase();
  const isCsv = CSV_EXTENSIONS.some((ext) => name.endsWith(ext));
  const isXlsx = XLSX_EXTENSIONS.some((ext) => name.endsWith(ext));
  if (!isCsv && !isXlsx) {
    throw new Error("Only CSV and Excel files are supported.");
  }

  const parsed = isCsv ? await parseCsv(file) : await parseXlsx(file);

  if (parsed.headers.length === 0 || parsed.rows.length === 0) {
    throw new Error(
      "We couldn't find any data in this file. Is the first row a header?"
    );
  }
  if (parsed.rows.length > MAX_ROWS) {
    throw new Error(
      `This file has ${parsed.rows.length} rows. Max supported is ${MAX_ROWS.toLocaleString()}. Split your file into smaller batches.`
    );
  }
  return parsed;
}

async function parseCsv(file: File): Promise<ParsedFile> {
  let text = await file.text();
  // Strip UTF-8 BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // Skip Dragon Shield sep=, hint line
  const firstNewline = text.indexOf("\n");
  if (firstNewline !== -1 && text.slice(0, firstNewline).trim().startsWith("sep=")) {
    text = text.slice(firstNewline + 1);
  }
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: (h) => h.trim(),
  });
  const headers = (result.meta.fields ?? []).map((h) => h.trim());
  const rows = (result.data ?? []).filter((r) => Object.values(r).some((v) => String(v ?? "").trim() !== ""));
  return {
    headers,
    rows,
    rowCount: rows.length,
    fileName: file.name,
    sizeBytes: file.size,
  };
}

async function parseXlsx(file: File): Promise<ParsedFile> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) throw new Error("This Excel file has no sheets.");
  const sheet = wb.Sheets[firstSheetName];
  const aoa = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });
  if (aoa.length === 0) return { headers: [], rows: [], rowCount: 0, fileName: file.name, sizeBytes: file.size };
  const headers = aoa[0].map((h) => String(h).trim()).filter(Boolean);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const row: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((h, idx) => {
      const v = aoa[i][idx];
      const str = v == null ? "" : String(v).trim();
      if (str) hasValue = true;
      row[h] = str;
    });
    if (hasValue) rows.push(row);
  }
  return {
    headers,
    rows,
    rowCount: rows.length,
    fileName: file.name,
    sizeBytes: file.size,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- parser
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/import/parser.ts src/lib/import/__tests__/parser.test.ts
git commit -m "feat(import): CSV + XLSX parser with sep= and BOM handling"
```

---

## Task 6: Column detector — header matching

Match each CSV header against the alias dictionary. Case-insensitive, whitespace-collapsed, punctuation-stripped comparison.

**Files:**
- Create: `src/lib/import/column-detector.ts`
- Create: `src/lib/import/__tests__/column-detector.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
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
    expect(mappings[1].field).toBe("card_name");
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- column-detector
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/import/column-detector.ts`**

```typescript
import type { ColumnMapping, KardVaultField, ParsedFile } from "./types";

const ALIASES: Record<KardVaultField, string[]> = {
  card_name: ["name", "card name", "card", "item", "product", "card_name", "product name", "item name"],
  set: ["set", "set name", "expansion", "series", "edition", "set code", "set_code"],
  card_number: ["number", "card number", "no", "#", "card_number", "collector number", "collector_number"],
  sell_price: ["price", "sell price", "sell", "my price", "tcg marketplace price", "marketplace price", "asking price"],
  buy_price: ["buy price", "cost price", "purchase price", "paid", "price bought", "purchase_price", "cost"],
  condition: ["condition", "cond", "quality"],
  quantity: ["qty", "quantity", "count", "amount", "total quantity", "add to quantity", "tradelist count"],
  grading: ["grade", "grading", "graded", "grader"],
};

function normalize(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const ALIAS_INDEX: Map<string, KardVaultField> = (() => {
  const idx = new Map<string, KardVaultField>();
  for (const [field, aliases] of Object.entries(ALIASES) as [KardVaultField, string[]][]) {
    for (const alias of aliases) idx.set(normalize(alias), field);
  }
  return idx;
})();

function sampleValuesFor(parsed: ParsedFile, column: string, n = 3): string[] {
  const out: string[] = [];
  for (const row of parsed.rows) {
    const v = (row[column] ?? "").toString().trim();
    if (v) out.push(v);
    if (out.length === n) break;
  }
  return out;
}

export function detectColumns(parsed: ParsedFile): ColumnMapping[] {
  const claimed = new Set<KardVaultField>();
  const mappings: ColumnMapping[] = [];

  for (const header of parsed.headers) {
    const normalized = normalize(header);
    const field = ALIAS_INDEX.get(normalized);
    const samples = sampleValuesFor(parsed, header);
    if (field && !claimed.has(field)) {
      claimed.add(field);
      mappings.push({ columnName: header, field, confidence: "header", sampleValues: samples });
    } else {
      mappings.push({ columnName: header, field: "skip", confidence: "manual", sampleValues: samples });
    }
  }

  return mappings;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- column-detector
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/import/column-detector.ts src/lib/import/__tests__/column-detector.test.ts
git commit -m "feat(import): column detector with header alias matching"
```

---

## Task 7: Column detector — data-pattern fallback

Extend `detectColumns` with a second pass: for columns the header matcher left as `skip`, examine data patterns to claim remaining unclaimed fields.

**Files:**
- Modify: `src/lib/import/column-detector.ts`
- Modify: `src/lib/import/__tests__/column-detector.test.ts`

- [ ] **Step 1: Append failing tests to `column-detector.test.ts`**

```typescript
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
    expect(q.field).toBe("quantity"); // header match
    // Random looks like small integers but can't claim quantity (already taken).
    // It CAN still claim card_number by pattern.
    expect(r.field).toBe("card_number");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- column-detector
```

Expected: new tests fail (pattern fallback not implemented).

- [ ] **Step 3: Update `src/lib/import/column-detector.ts` to include pattern fallback**

Replace the entire file with:

```typescript
import { normalizeCondition } from "./condition-normalizer";
import type { ColumnMapping, KardVaultField, ParsedFile } from "./types";

const ALIASES: Record<KardVaultField, string[]> = {
  card_name: ["name", "card name", "card", "item", "product", "card_name", "product name", "item name"],
  set: ["set", "set name", "expansion", "series", "edition", "set code", "set_code"],
  card_number: ["number", "card number", "no", "#", "card_number", "collector number", "collector_number"],
  sell_price: ["price", "sell price", "sell", "my price", "tcg marketplace price", "marketplace price", "asking price"],
  buy_price: ["buy price", "cost price", "purchase price", "paid", "price bought", "purchase_price", "cost"],
  condition: ["condition", "cond", "quality"],
  quantity: ["qty", "quantity", "count", "amount", "total quantity", "add to quantity", "tradelist count"],
  grading: ["grade", "grading", "graded", "grader"],
};

const CARD_NUMBER_RE = /^(\d{1,4}(\/\d{1,4})?|[A-Z]{1,4}\d{1,4}(-\d{1,4})?)$/;
const POSITIVE_INT_RE = /^\d{1,4}$/;
const POSITIVE_FLOAT_RE = /^\d+(\.\d+)?$/;
const GRADING_RE = /(PSA|BGS|CGC|ACE|SGC)\s*\d+(\.\d+)?/i;

function normalize(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const ALIAS_INDEX: Map<string, KardVaultField> = (() => {
  const idx = new Map<string, KardVaultField>();
  for (const [field, aliases] of Object.entries(ALIASES) as [KardVaultField, string[]][]) {
    for (const alias of aliases) idx.set(normalize(alias), field);
  }
  return idx;
})();

function sampleValuesFor(parsed: ParsedFile, column: string, n = 3): string[] {
  const out: string[] = [];
  for (const row of parsed.rows) {
    const v = (row[column] ?? "").toString().trim();
    if (v) out.push(v);
    if (out.length === n) break;
  }
  return out;
}

function nonEmptyValues(parsed: ParsedFile, column: string): string[] {
  const out: string[] = [];
  for (const row of parsed.rows) {
    const v = (row[column] ?? "").toString().trim();
    if (v) out.push(v);
  }
  return out;
}

function percentMatch(values: string[], test: (v: string) => boolean): number {
  if (values.length === 0) return 0;
  const hits = values.reduce((n, v) => (test(v) ? n + 1 : n), 0);
  return hits / values.length;
}

function guessByPattern(values: string[], claimed: Set<KardVaultField>): KardVaultField | null {
  if (values.length === 0) return null;
  if (!claimed.has("card_number") && percentMatch(values, (v) => CARD_NUMBER_RE.test(v)) >= 0.8) {
    return "card_number";
  }
  if (!claimed.has("quantity") && percentMatch(values, (v) => POSITIVE_INT_RE.test(v) && parseInt(v, 10) > 0 && parseInt(v, 10) < 10000) >= 0.9) {
    return "quantity";
  }
  if (!claimed.has("sell_price") && percentMatch(values, (v) => POSITIVE_FLOAT_RE.test(v) && parseFloat(v) > 0 && parseFloat(v) < 100000) >= 0.8) {
    return "sell_price";
  }
  if (!claimed.has("condition") && percentMatch(values, (v) => normalizeCondition(v) !== null) >= 0.7) {
    return "condition";
  }
  if (!claimed.has("grading") && percentMatch(values, (v) => GRADING_RE.test(v)) >= 0.3) {
    return "grading";
  }
  return null;
}

export function detectColumns(parsed: ParsedFile): ColumnMapping[] {
  const claimed = new Set<KardVaultField>();
  const mappings: ColumnMapping[] = parsed.headers.map((header) => ({
    columnName: header,
    field: "skip" as KardVaultField | "skip",
    confidence: "manual" as ColumnMapping["confidence"],
    sampleValues: sampleValuesFor(parsed, header),
  }));

  // Pass 1 — header match
  mappings.forEach((m) => {
    const field = ALIAS_INDEX.get(normalize(m.columnName));
    if (field && !claimed.has(field)) {
      claimed.add(field);
      m.field = field;
      m.confidence = "header";
    }
  });

  // Pass 2 — data pattern fallback for still-skip columns
  mappings.forEach((m) => {
    if (m.field !== "skip") return;
    const values = nonEmptyValues(parsed, m.columnName);
    const guess = guessByPattern(values, claimed);
    if (guess) {
      claimed.add(guess);
      m.field = guess;
      m.confidence = "pattern";
    }
  });

  return mappings;
}
```

- [ ] **Step 4: Run test**

```bash
npm test -- column-detector
```

Expected: all passing (both header and pattern test suites).

- [ ] **Step 5: Commit**

```bash
git add src/lib/import/column-detector.ts src/lib/import/__tests__/column-detector.test.ts
git commit -m "feat(import): data-pattern fallback in column detector"
```

---

## Task 8: `match_cards` Postgres RPC migration

Adds the fuzzy-match RPC that the matcher module calls.

**Files:**
- Create: `supabase/migrations/00004_import_matching.sql`

- [ ] **Step 1: Write `supabase/migrations/00004_import_matching.sql`**

```sql
-- Import flow: fuzzy-match imported card names against cards table
-- Idempotent re-declaration of pg_trgm index (already in 00002 but safe to repeat)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_cards_name_trgm ON cards USING gin (name gin_trgm_ops);

CREATE OR REPLACE FUNCTION match_cards(
  p_name TEXT,
  p_set_hint TEXT DEFAULT NULL,
  p_number_hint TEXT DEFAULT NULL
)
RETURNS TABLE (
  id TEXT,
  name TEXT,
  set_name TEXT,
  card_number TEXT,
  image_small TEXT,
  market_price_rm DECIMAL,
  score REAL
)
LANGUAGE sql STABLE AS $$
  SELECT
    c.id,
    c.name,
    c.set_name,
    c.card_number,
    c.image_small,
    c.market_price_rm,
    (
      similarity(c.name, p_name)
      + CASE WHEN p_set_hint IS NOT NULL AND c.set_name ILIKE '%' || p_set_hint || '%' THEN 0.2 ELSE 0 END
      + CASE WHEN p_number_hint IS NOT NULL AND c.card_number = p_number_hint THEN 0.3 ELSE 0 END
    )::real AS score
  FROM cards c
  WHERE similarity(c.name, p_name) > 0.2
  ORDER BY score DESC
  LIMIT 3;
$$;

GRANT EXECUTE ON FUNCTION match_cards(TEXT, TEXT, TEXT) TO authenticated;
```

- [ ] **Step 2: Apply migration locally**

```bash
npx supabase db push
```

Expected: migration applies without errors.

- [ ] **Step 3: Verify the RPC works via `psql` or the Supabase SQL editor**

Run:

```sql
SELECT * FROM match_cards('Charizard', NULL, NULL);
```

Expected: returns up to 3 rows of Charizard-ish cards with `score` column populated.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00004_import_matching.sql
git commit -m "feat(import): match_cards RPC for fuzzy import matching"
```

---

## Task 9: Matcher module

Calls the `match_cards` RPC for each row, classifies the result by confidence, builds `MatchResult[]`. Applies the condition normalizer, grading parser, and numeric field parsing to each row.

**Files:**
- Create: `src/lib/import/matcher.ts`
- Create: `src/lib/import/__tests__/matcher.test.ts`

- [ ] **Step 1: Write the failing test**

Matcher is dependent on Supabase — test with a manual stub of the RPC rather than a real network call.

```typescript
import { describe, it, expect, vi } from "vitest";
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- matcher
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/import/matcher.ts`**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCondition } from "./condition-normalizer";
import { parseGrading } from "./grading-parser";
import type { CardCandidate, ColumnMapping, MatchResult, ParsedFile } from "./types";

const BATCH_SIZE = 50;

export type Condition = "NM" | "LP" | "MP" | "HP" | "DMG";

function getField(
  row: Record<string, string>,
  mapping: ColumnMapping[],
  field: ColumnMapping["field"]
): string | null {
  const col = mapping.find((m) => m.field === field);
  if (!col) return null;
  const v = row[col.columnName];
  return v == null ? null : v.toString().trim() || null;
}

function parseFloatOrNull(v: string | null): number | null {
  if (!v) return null;
  const cleaned = v.replace(/[^\d.\-]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseIntOrOne(v: string | null): number {
  if (!v) return 1;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function buildMappedFields(
  row: Record<string, string>,
  mapping: ColumnMapping[],
  defaultCondition: Condition
): MatchResult["mappedFields"] {
  const conditionRaw = getField(row, mapping, "condition");
  const condition = normalizeCondition(conditionRaw) ?? defaultCondition;
  const gradingRaw = getField(row, mapping, "grading");
  const grading = parseGrading(gradingRaw);
  return {
    sellPriceRm: parseFloatOrNull(getField(row, mapping, "sell_price")),
    buyPriceRm: parseFloatOrNull(getField(row, mapping, "buy_price")),
    condition,
    quantity: parseIntOrOne(getField(row, mapping, "quantity")),
    gradingCompany: grading?.gradingCompany ?? null,
    grade: grading?.grade ?? null,
  };
}

export function classifyCandidates(cands: CardCandidate[]): MatchResult["status"] {
  if (cands.length === 0) return "not_found";
  const top = cands[0].score;
  if (top < 0.4) return "not_found";
  if (top < 0.7) return "uncertain";
  if (cands.length >= 2 && top - cands[1].score < 0.05) return "uncertain";
  return "matched";
}

async function fetchCandidates(
  supabase: SupabaseClient,
  name: string,
  setHint: string | null,
  numberHint: string | null
): Promise<CardCandidate[]> {
  const { data, error } = await supabase.rpc("match_cards", {
    p_name: name,
    p_set_hint: setHint,
    p_number_hint: numberHint,
  });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    name: r.name as string,
    setName: r.set_name as string,
    cardNumber: r.card_number as string,
    imageSmall: (r.image_small as string | null) ?? null,
    marketPriceRm: (r.market_price_rm as number | null) ?? null,
    score: r.score as number,
  }));
}

export async function matchRows(
  supabase: SupabaseClient,
  parsed: ParsedFile,
  mapping: ColumnMapping[],
  defaultCondition: Condition = "NM"
): Promise<MatchResult[]> {
  const nameCol = mapping.find((m) => m.field === "card_name");
  if (!nameCol) throw new Error("card_name column must be mapped before matching");

  const results: MatchResult[] = [];
  for (let start = 0; start < parsed.rows.length; start += BATCH_SIZE) {
    const chunk = parsed.rows.slice(start, start + BATCH_SIZE);
    const chunkResults = await Promise.all(
      chunk.map(async (row, localIdx) => {
        const idx = start + localIdx;
        const name = (row[nameCol.columnName] ?? "").trim();
        if (!name) {
          return {
            rowIndex: idx,
            rawCardName: "",
            status: "not_found",
            candidates: [],
            selectedCardId: null,
            mappedFields: buildMappedFields(row, mapping, defaultCondition),
          } satisfies MatchResult;
        }
        const setHint = getField(row, mapping, "set");
        const numberHint = getField(row, mapping, "card_number");
        const cands = await fetchCandidates(supabase, name, setHint, numberHint);
        const status = classifyCandidates(cands);
        return {
          rowIndex: idx,
          rawCardName: name,
          status,
          candidates: cands,
          selectedCardId: status === "matched" ? cands[0].id : null,
          mappedFields: buildMappedFields(row, mapping, defaultCondition),
        } satisfies MatchResult;
      })
    );
    results.push(...chunkResults);
  }
  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- matcher
```

Expected: all passing (tests only cover the pure functions; network-level `matchRows` is exercised by manual testing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/import/matcher.ts src/lib/import/__tests__/matcher.test.ts
git commit -m "feat(import): matcher with RPC wrapper and classification logic"
```

---

## Task 10: Feature flag plumbing

Add the `NEXT_PUBLIC_CSV_IMPORT_ENABLED` env var and a shared layout that 404s when disabled.

**Files:**
- Create: `src/app/import/layout.tsx`
- Modify: `.env.example` (create if absent)
- Modify: `.env.local`

- [ ] **Step 1: Add env var to `.env.example`**

Append:

```
# Toggle the CSV import flow — default off
NEXT_PUBLIC_CSV_IMPORT_ENABLED=false
```

- [ ] **Step 2: Set it to true in `.env.local`**

Append:

```
NEXT_PUBLIC_CSV_IMPORT_ENABLED=true
```

- [ ] **Step 3: Write `src/app/import/layout.tsx`**

```typescript
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

export default function ImportLayout({ children }: { children: ReactNode }) {
  if (process.env.NEXT_PUBLIC_CSV_IMPORT_ENABLED !== "true") {
    notFound();
  }
  return <div className="min-h-screen bg-bg-primary text-text-primary">{children}</div>;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/import/layout.tsx .env.example
git commit -m "feat(import): feature-flag the import flow via NEXT_PUBLIC_CSV_IMPORT_ENABLED"
```

---

## Task 11: sessionStorage helper for import state

Keeps the three screens in sync. Screen 1 writes; screens 2 and 3 read (and write back their additions).

**Files:**
- Create: `src/lib/import/session-state.ts`
- Create: `src/lib/import/__tests__/session-state.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { saveImportState, loadImportState, clearImportState, newImportId } from "../session-state";
import type { ImportSessionState } from "../types";

function stubState(): ImportSessionState {
  return {
    importId: "abc123",
    parsedFile: { headers: ["Name"], rows: [{ Name: "x" }], rowCount: 1, fileName: "t.csv", sizeBytes: 1 },
    mappings: [],
    matchResults: [],
    batchPricingRule: "market",
    createdAt: Date.now(),
  };
}

describe("session-state", () => {
  beforeEach(() => sessionStorage.clear());

  it("round-trips state", () => {
    const state = stubState();
    saveImportState(state);
    expect(loadImportState("abc123")).toEqual(state);
  });

  it("returns null for missing state", () => {
    expect(loadImportState("nope")).toBeNull();
  });

  it("clears state", () => {
    saveImportState(stubState());
    clearImportState("abc123");
    expect(loadImportState("abc123")).toBeNull();
  });

  it("expires state older than 24h", () => {
    const state = { ...stubState(), createdAt: Date.now() - 25 * 3600 * 1000 };
    saveImportState(state);
    expect(loadImportState("abc123")).toBeNull();
  });

  it("newImportId returns unique non-empty ids", () => {
    expect(newImportId()).toBeTruthy();
    expect(newImportId()).not.toBe(newImportId());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- session-state
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/import/session-state.ts`**

```typescript
import type { ImportSessionState } from "./types";

const PREFIX = "kv_import_";
const EXPIRY_MS = 24 * 3600 * 1000;

export function newImportId(): string {
  return crypto.randomUUID();
}

export function saveImportState(state: ImportSessionState): void {
  sessionStorage.setItem(PREFIX + state.importId, JSON.stringify(state));
}

export function loadImportState(id: string): ImportSessionState | null {
  const raw = sessionStorage.getItem(PREFIX + id);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ImportSessionState;
    if (Date.now() - parsed.createdAt > EXPIRY_MS) {
      clearImportState(id);
      return null;
    }
    return parsed;
  } catch {
    clearImportState(id);
    return null;
  }
}

export function clearImportState(id: string): void {
  sessionStorage.removeItem(PREFIX + id);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- session-state
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/import/session-state.ts src/lib/import/__tests__/session-state.test.ts
git commit -m "feat(import): sessionStorage state helpers"
```

---

## Task 12: Upload screen

The first screen in the flow. Drag-and-drop or click-to-select, parses the file, shows summary, proceeds to mapping.

**Files:**
- Create: `src/app/import/page.tsx`
- Create: `src/components/import/upload-dropzone.tsx`

- [ ] **Step 1: Write `src/components/import/upload-dropzone.tsx`**

```typescript
"use client";

import { useRef, useState, type DragEvent } from "react";

type Props = {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
};

export function UploadDropzone({ onFileSelected, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFileSelected(file);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
        isDragging ? "border-primary-400 bg-bg-surface" : "border-[rgba(124,107,181,0.25)] bg-bg-surface/60"
      } ${disabled ? "opacity-50" : "cursor-pointer"}`}
      onClick={() => !disabled && inputRef.current?.click()}
    >
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary-800">
        <svg className="h-6 w-6 text-primary-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
        </svg>
      </div>
      <div className="text-base font-medium text-text-primary">Upload your spreadsheet</div>
      <div className="mt-2 text-xs text-text-secondary">
        Supports CSV and Excel (.xlsx) files. We&apos;ll auto-detect your columns.
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelected(file);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Write `src/app/import/page.tsx`**

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { parseFile } from "@/lib/import/parser";
import { detectColumns } from "@/lib/import/column-detector";
import { newImportId, saveImportState } from "@/lib/import/session-state";
import { UploadDropzone } from "@/components/import/upload-dropzone";
import type { ParsedFile } from "@/lib/import/types";

export default function ImportUploadPage() {
  const router = useRouter();
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setParsed(null);
    setParsing(true);
    try {
      const result = await parseFile(file);
      setParsed(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse file.");
    } finally {
      setParsing(false);
    }
  };

  const handleContinue = () => {
    if (!parsed) return;
    const importId = newImportId();
    saveImportState({
      importId,
      parsedFile: parsed,
      mappings: detectColumns(parsed),
      matchResults: [],
      batchPricingRule: "market",
      createdAt: Date.now(),
    });
    router.push(`/import/mapping?id=${importId}`);
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/inventory" aria-label="Back" className="text-text-secondary">
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <h1 className="text-lg font-semibold">Import inventory</h1>
      </div>

      <UploadDropzone onFileSelected={handleFile} disabled={parsing} />

      {parsing && <div className="mt-4 text-sm text-text-secondary">Parsing…</div>}

      {error && (
        <div className="mt-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      {parsed && !error && (
        <div className="mt-4 rounded-xl border border-success/40 bg-bg-surface p-4">
          <div className="text-sm font-medium text-text-primary">{parsed.fileName}</div>
          <div className="mt-1 text-xs text-text-secondary">
            {parsed.rowCount} rows · {parsed.headers.length} columns · {Math.round(parsed.sizeBytes / 1024)} KB
          </div>
        </div>
      )}

      <div className="my-6 text-center text-xs text-text-muted">— or start with our template —</div>

      <a
        href="/templates/kardvault-template.csv"
        download
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-[rgba(124,107,181,0.25)] py-3 text-sm text-text-primary"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
        </svg>
        Download KardVault CSV template
      </a>

      <button
        disabled={!parsed || parsing}
        onClick={handleContinue}
        className="mt-6 w-full rounded-lg bg-primary-400 py-3 font-medium text-text-on-primary disabled:opacity-40"
      >
        Continue to column mapping
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Manual verification**

Run `npm run dev`, visit `http://localhost:3000/import`. Verify:
- Drop a tiny CSV (e.g. `name,qty\nCharizard,1`) → summary card appears.
- Drop an invalid file (`.txt`) → error message.
- Click "Continue" → URL changes to `/import/mapping?id=...` (mapping page is 404 until Task 13).

- [ ] **Step 4: Commit**

```bash
git add src/app/import/page.tsx src/components/import/upload-dropzone.tsx
git commit -m "feat(import): upload screen with drag-and-drop"
```

---

## Task 13: Mapping screen

**Files:**
- Create: `src/app/import/mapping/page.tsx`
- Create: `src/components/import/column-mapping-row.tsx`

- [ ] **Step 1: Write `src/components/import/column-mapping-row.tsx`**

```typescript
"use client";

import type { ColumnMapping, KardVaultField } from "@/lib/import/types";
import { FIELD_LABELS } from "@/lib/import/types";

type Props = {
  mapping: ColumnMapping;
  onChange: (field: KardVaultField | "skip") => void;
};

const FIELD_OPTIONS: Array<KardVaultField | "skip"> = [
  "card_name",
  "set",
  "card_number",
  "sell_price",
  "buy_price",
  "condition",
  "quantity",
  "grading",
  "skip",
];

export function ColumnMappingRow({ mapping, onChange }: Props) {
  const icon =
    mapping.confidence === "header" || (mapping.confidence === "pattern" && mapping.field !== "skip") ? (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-success/20 text-success">✓</span>
    ) : mapping.field === "skip" ? (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-bg-hover text-text-muted">–</span>
    ) : (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary-800 text-primary-200">?</span>
    );

  return (
    <div className="flex items-center gap-3 rounded-xl border border-[rgba(124,107,181,0.12)] bg-bg-surface p-3">
      <div className="flex-shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{mapping.columnName}</div>
        <div className="truncate text-xs text-text-muted">
          {mapping.sampleValues.slice(0, 3).join(" · ") || "—"}
        </div>
        {mapping.confidence === "header" && (
          <div className="mt-1 inline-block rounded bg-primary-800/60 px-1.5 py-0.5 text-[10px] text-primary-200">
            Auto-detected
          </div>
        )}
        {mapping.confidence === "pattern" && mapping.field !== "skip" && (
          <div className="mt-1 inline-block rounded bg-warning/20 px-1.5 py-0.5 text-[10px] text-warning">
            Guessed from data
          </div>
        )}
      </div>
      <div className="flex-shrink-0 text-text-muted">→</div>
      <select
        value={mapping.field}
        onChange={(e) => onChange(e.target.value as KardVaultField | "skip")}
        className="flex-shrink-0 rounded-md border border-[rgba(124,107,181,0.25)] bg-bg-surface-2 px-2 py-1.5 text-sm"
      >
        {FIELD_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>
            {opt === "skip" ? "Skip" : FIELD_LABELS[opt]}
          </option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/app/import/mapping/page.tsx`**

```typescript
"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { loadImportState, saveImportState } from "@/lib/import/session-state";
import { ColumnMappingRow } from "@/components/import/column-mapping-row";
import type { ColumnMapping, ImportSessionState, KardVaultField } from "@/lib/import/types";

export default function MappingPage() {
  const router = useRouter();
  const params = useSearchParams();
  const importId = params.get("id");
  const [state, setState] = useState<ImportSessionState | null>(null);

  useEffect(() => {
    if (!importId) {
      router.replace("/import");
      return;
    }
    const s = loadImportState(importId);
    if (!s) {
      router.replace("/import");
      return;
    }
    setState(s);
  }, [importId, router]);

  if (!state) return null;

  const updateField = (idx: number, field: KardVaultField | "skip") => {
    const next = [...state.mappings];
    // enforce field uniqueness — if another row had this field, reset it to skip
    if (field !== "skip") {
      next.forEach((m, i) => {
        if (i !== idx && m.field === field) {
          next[i] = { ...m, field: "skip", confidence: "manual" };
        }
      });
    }
    next[idx] = { ...next[idx], field, confidence: "manual" };
    const updated = { ...state, mappings: next };
    setState(updated);
    saveImportState(updated);
  };

  const autoDetectedCount = state.mappings.filter(
    (m) => (m.confidence === "header" || m.confidence === "pattern") && m.field !== "skip"
  ).length;

  const hasCardName = state.mappings.some((m) => m.field === "card_name");

  const handleContinue = () => {
    router.push(`/import/preview?id=${state.importId}`);
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/import" aria-label="Back" className="text-text-secondary">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </Link>
          <h1 className="text-lg font-semibold">Map your columns</h1>
        </div>
        <div className="text-xs text-success">{autoDetectedCount} auto-detected</div>
      </div>

      <p className="mb-4 text-xs text-text-muted">
        We detected {state.mappings.length} columns in your file. Confirm or adjust the mapping below.
      </p>

      <div className="space-y-3">
        {state.mappings.map((m, i) => (
          <ColumnMappingRow key={m.columnName} mapping={m} onChange={(f) => updateField(i, f)} />
        ))}
      </div>

      {!hasCardName && (
        <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          Map at least one column to <strong>Card name</strong> to continue.
        </div>
      )}

      <button
        disabled={!hasCardName}
        onClick={handleContinue}
        className="mt-6 w-full rounded-lg bg-primary-400 py-3 font-medium text-text-on-primary disabled:opacity-40"
      >
        Match {state.parsedFile.rowCount} cards against database
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Manual verification**

Run `npm run dev`, upload a CSV with recognizable headers (`name,set,qty,price`). On `/import/mapping?id=...`:
- See each column with detected field + dropdown
- Change a dropdown → state persists (reload page, value stays)
- Auto-detected count updates
- CTA disabled if no `card_name` mapped

- [ ] **Step 4: Commit**

```bash
git add src/app/import/mapping/page.tsx src/components/import/column-mapping-row.tsx
git commit -m "feat(import): column mapping screen"
```

---

## Task 14: Batch pricing selector component

Used on the preview screen. Shows when no `sell_price` column was mapped; determines the default sell price rule.

**Files:**
- Create: `src/components/import/batch-pricing-selector.tsx`

- [ ] **Step 1: Write `src/components/import/batch-pricing-selector.tsx`**

```typescript
"use client";

import type { ImportSessionState } from "@/lib/import/types";

type Rule = ImportSessionState["batchPricingRule"];

type Props = {
  value: Rule;
  onChange: (rule: Rule) => void;
};

const PRESETS: Array<{ label: string; rule: Rule }> = [
  { label: "At market", rule: "market" },
  { label: "90% mkt", rule: "0.9" },
  { label: "80% mkt", rule: "0.8" },
];

export function BatchPricingSelector({ value, onChange }: Props) {
  const isCustom = typeof value === "number";
  const customMultiplier = isCustom ? (value as number) : 1;
  return (
    <div className="rounded-xl border border-[rgba(124,107,181,0.12)] bg-bg-surface p-4">
      <div className="mb-2 text-xs uppercase tracking-wide text-text-muted">Batch pricing rule</div>
      <div className="mb-3 text-xs text-text-secondary">
        Your file didn&apos;t include a sell-price column. Choose how to set asking prices.
      </div>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => onChange(p.rule)}
            className={`rounded-md px-3 py-1.5 text-sm ${
              value === p.rule ? "bg-primary-400 text-text-on-primary" : "bg-bg-surface-2 text-text-primary"
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => onChange(customMultiplier)}
          className={`rounded-md px-3 py-1.5 text-sm ${
            isCustom ? "bg-primary-400 text-text-on-primary" : "bg-bg-surface-2 text-text-primary"
          }`}
        >
          Custom
        </button>
        {isCustom && (
          <input
            type="number"
            step="0.05"
            min="0.5"
            max="2"
            value={customMultiplier}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              if (Number.isFinite(n) && n >= 0.5 && n <= 2) onChange(n);
            }}
            className="w-20 rounded-md border border-[rgba(124,107,181,0.25)] bg-bg-surface-2 px-2 py-1.5 text-sm"
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/import/batch-pricing-selector.tsx
git commit -m "feat(import): batch pricing selector component"
```

---

## Task 15: Preview screen with match + import

The third screen. Runs the matcher on mount, shows results, applies batch pricing, imports.

**Files:**
- Create: `src/app/import/preview/page.tsx`
- Create: `src/components/import/match-result-row.tsx`

- [ ] **Step 1: Write `src/components/import/match-result-row.tsx`**

```typescript
"use client";

import Image from "next/image";
import type { MatchResult } from "@/lib/import/types";

type Props = { result: MatchResult };

export function MatchResultRow({ result }: Props) {
  const top = result.candidates[0];
  if (result.status === "matched" && top) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-bg-surface p-3">
        {top.imageSmall ? (
          <Image src={top.imageSmall} alt="" width={40} height={56} className="rounded" />
        ) : (
          <div className="h-14 w-10 rounded bg-bg-hover" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{top.name}</div>
          <div className="truncate text-xs text-text-secondary">
            {top.setName} · #{top.cardNumber}
          </div>
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="text-xs font-medium text-success">Matched</div>
          <div className="text-[10px] text-text-muted">{Math.round(top.score * 100)}% match</div>
        </div>
      </div>
    );
  }
  if (result.status === "uncertain" && top) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-warning/30 bg-bg-surface p-3">
        {top.imageSmall ? (
          <Image src={top.imageSmall} alt="" width={40} height={56} className="rounded" />
        ) : (
          <div className="h-14 w-10 rounded bg-bg-hover" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            &ldquo;{result.rawCardName}&rdquo; → {top.name}?
          </div>
          <div className="truncate text-xs text-text-secondary">{top.setName}</div>
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="text-xs font-medium text-warning">Uncertain</div>
          <div className="text-[10px] text-text-muted">{Math.round(top.score * 100)}% match</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-xl border border-danger/30 bg-bg-surface p-3">
      <div className="h-14 w-10 rounded bg-bg-hover" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{result.rawCardName || "(empty name)"}</div>
        <div className="truncate text-xs text-text-secondary">No match in database</div>
      </div>
      <div className="flex-shrink-0 text-right text-xs font-medium text-danger">Not found</div>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/app/import/preview/page.tsx`**

```typescript
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useVendor } from "@/hooks/use-vendor";
import { loadImportState, saveImportState, clearImportState } from "@/lib/import/session-state";
import { matchRows } from "@/lib/import/matcher";
import { BatchPricingSelector } from "@/components/import/batch-pricing-selector";
import { MatchResultRow } from "@/components/import/match-result-row";
import type { ImportSessionState, MatchResult } from "@/lib/import/types";

type Filter = "all" | "matched" | "uncertain" | "not_found";

export default function PreviewPage() {
  const router = useRouter();
  const params = useSearchParams();
  const importId = params.get("id");
  const { user } = useAuth();
  const { vendor } = useVendor(user?.id);

  const [state, setState] = useState<ImportSessionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(false);

  useEffect(() => {
    if (!importId) {
      router.replace("/import");
      return;
    }
    const s = loadImportState(importId);
    if (!s) {
      router.replace("/import");
      return;
    }
    if (s.matchResults.length === 0) {
      matchRows(supabase, s.parsedFile, s.mappings)
        .then((results) => {
          const updated = { ...s, matchResults: results };
          saveImportState(updated);
          setState(updated);
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Matching failed."))
        .finally(() => setLoading(false));
    } else {
      setState(s);
      setLoading(false);
    }
  }, [importId, router]);

  const counts = useMemo(() => {
    if (!state) return { all: 0, matched: 0, uncertain: 0, not_found: 0 };
    return state.matchResults.reduce(
      (acc, r) => {
        acc.all++;
        acc[r.status]++;
        return acc;
      },
      { all: 0, matched: 0, uncertain: 0, not_found: 0 } as Record<Filter, number>
    );
  }, [state]);

  const hasSellPriceColumn = state?.mappings.some((m) => m.field === "sell_price") ?? false;

  const setRule = (rule: ImportSessionState["batchPricingRule"]) => {
    if (!state) return;
    const updated = { ...state, batchPricingRule: rule };
    saveImportState(updated);
    setState(updated);
  };

  const filtered: MatchResult[] = useMemo(() => {
    if (!state) return [];
    if (filter === "all") return state.matchResults;
    return state.matchResults.filter((r) => r.status === filter);
  }, [state, filter]);

  const handleImport = async () => {
    if (!state || !vendor) return;
    setImporting(true);
    setError(null);
    try {
      const matched = state.matchResults.filter(
        (r) => r.status === "matched" && r.selectedCardId
      );
      const rows = matched.map((r) => {
        const cand = r.candidates.find((c) => c.id === r.selectedCardId) ?? r.candidates[0];
        const sellPrice = r.mappedFields.sellPriceRm ?? computeSellPrice(cand.marketPriceRm, state.batchPricingRule);
        return {
          vendor_id: vendor.id,
          card_id: r.selectedCardId!,
          condition: r.mappedFields.condition,
          quantity: r.mappedFields.quantity,
          sell_price_rm: sellPrice,
          buy_price_rm: r.mappedFields.buyPriceRm,
          grading_company: r.mappedFields.gradingCompany,
          grade: r.mappedFields.grade,
        };
      });
      if (rows.length === 0) {
        setError("No matched rows to import.");
        return;
      }
      const { error: insertError } = await supabase.from("inventory").upsert(rows, {
        onConflict: "vendor_id,card_id,condition,grading_company,grade",
      });
      if (insertError) throw insertError;
      clearImportState(state.importId);
      setImported(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-text-secondary">Matching cards…</div>;
  if (!state) return null;
  if (imported) {
    return (
      <div className="mx-auto max-w-xl px-4 py-8 text-center">
        <div className="mb-4 text-2xl">🎉</div>
        <h1 className="text-lg font-semibold">Import complete</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Added {counts.matched} cards to your inventory.
        </p>
        <Link href="/inventory" className="mt-6 inline-block rounded-lg bg-primary-400 px-6 py-3 text-sm font-medium text-text-on-primary">
          Back to inventory
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link href={`/import/mapping?id=${state.importId}`} aria-label="Back" className="text-text-secondary">
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <h1 className="text-lg font-semibold">Review matches</h1>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        <SummaryPill label="Matched" count={counts.matched} tone="success" />
        <SummaryPill label="Uncertain" count={counts.uncertain} tone="warning" />
        <SummaryPill label="Not found" count={counts.not_found} tone="danger" />
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto">
        {(["all", "matched", "uncertain", "not_found"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${
              filter === f ? "bg-primary-400 text-text-on-primary" : "bg-bg-surface-2 text-text-primary"
            }`}
          >
            {f === "all" ? "All" : f === "not_found" ? "Not found" : f[0].toUpperCase() + f.slice(1)} ({counts[f]})
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.map((r) => (
          <MatchResultRow key={r.rowIndex} result={r} />
        ))}
      </div>

      {!hasSellPriceColumn && (
        <div className="mt-6">
          <BatchPricingSelector value={state.batchPricingRule} onChange={setRule} />
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      <button
        disabled={importing || counts.matched === 0}
        onClick={handleImport}
        className="mt-6 w-full rounded-lg bg-primary-400 py-3 font-medium text-text-on-primary disabled:opacity-40"
      >
        {importing ? "Importing…" : `Import ${counts.matched} matched cards`}
      </button>

      <p className="mt-3 text-center text-xs text-text-muted">
        {counts.uncertain} uncertain + {counts.not_found} not found will be skipped. You can add them manually later.
      </p>
    </div>
  );
}

function SummaryPill({ label, count, tone }: { label: string; count: number; tone: "success" | "warning" | "danger" }) {
  const bg = tone === "success" ? "bg-success/10 border-success/30" : tone === "warning" ? "bg-warning/10 border-warning/30" : "bg-danger/10 border-danger/30";
  const color = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-danger";
  return (
    <div className={`rounded-xl border ${bg} p-2`}>
      <div className={`text-lg font-semibold ${color}`}>{count}</div>
      <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
    </div>
  );
}

function computeSellPrice(marketPriceRm: number | null, rule: ImportSessionState["batchPricingRule"]): number {
  const base = marketPriceRm ?? 0;
  if (rule === "market") return base;
  if (rule === "0.9") return +(base * 0.9).toFixed(2);
  if (rule === "0.8") return +(base * 0.8).toFixed(2);
  return +(base * rule).toFixed(2);
}
```

- [ ] **Step 3: Manual verification**

Apply migration (`npx supabase db push` if not done) and have at least a few cards in the local `cards` table. Then:
- Upload a CSV with 5 rows, proceed through mapping, land on preview.
- See matching run, rows classified into matched/uncertain/not_found.
- Toggle filter chips.
- If no sell-price column, batch pricing selector appears.
- Click "Import N matched cards" → success screen, inventory updates.

- [ ] **Step 4: Commit**

```bash
git add src/app/import/preview/page.tsx src/components/import/match-result-row.tsx
git commit -m "feat(import): preview screen with match + import"
```

---

## Task 16: CSV template + inventory page entry point

**Files:**
- Create: `public/templates/kardvault-template.csv`
- Modify: `src/app/(vendor)/inventory/page.tsx`

- [ ] **Step 1: Write `public/templates/kardvault-template.csv`**

```
Card name,Set,Card number,Condition,Quantity,Sell price,Buy price,Grading
Charizard ex,Obsidian Flames,125,NM,1,250.00,200.00,
Pikachu VMAX,Vivid Voltage,44,LP,2,80.00,60.00,
Mew ex,151,151,NM,1,180.00,,PSA 10
```

- [ ] **Step 2: Add "Import CSV" button to `src/app/(vendor)/inventory/page.tsx`**

Find the action-buttons row (per the UI spec in CLAUDE.md, this is a 3-button row near the top). Add a button that links to `/import` and is visible only when the feature flag is on.

Locate the relevant JSX (around the search bar / summary row — check the file for the existing actions section) and add:

```tsx
{process.env.NEXT_PUBLIC_CSV_IMPORT_ENABLED === "true" && (
  <Link
    href="/import"
    className="flex items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-800 py-2.5 text-sm text-primary-200"
  >
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
    </svg>
    Import CSV
  </Link>
)}
```

If the current inventory page doesn't have a button row, add one above the existing search bar.

- [ ] **Step 3: Manual verification**

With `NEXT_PUBLIC_CSV_IMPORT_ENABLED=true`, open `/inventory`. See the Import CSV button. Click it → lands on `/import`. Download the template link → file downloads.

- [ ] **Step 4: Commit**

```bash
git add public/templates/kardvault-template.csv src/app/\(vendor\)/inventory/page.tsx
git commit -m "feat(import): inventory page entry point + CSV template"
```

---

## Task 17: Fixture-based integration tests

Synthesize one representative file per competitor app and assert end-to-end auto-detection.

**Files:**
- Create: `src/lib/import/__fixtures__/manabox.csv`
- Create: `src/lib/import/__fixtures__/dragonshield.csv`
- Create: `src/lib/import/__fixtures__/deckbox.csv`
- Create: `src/lib/import/__fixtures__/tcgplayer-seller.csv`
- Create: `src/lib/import/__fixtures__/vendor-freeform.csv`
- Create: `src/lib/import/__tests__/fixtures.test.ts`

- [ ] **Step 1: Write the fixtures**

`manabox.csv`:
```
Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,Purchase price,Condition,Language
Charizard ex,OBF,Obsidian Flames,125,normal,Ultra Rare,1,200.00,near_mint,en
Pikachu VMAX,VIV,Vivid Voltage,44,foil,VMAX,2,60.00,lightly_played,en
```

`dragonshield.csv`:
```
sep=,
Folder Name,Quantity,Trade Quantity,Card Name,Set Code,Set Name,Card Number,Condition,Printing,Language,Price Bought,Date Bought
My Cards,1,0,Charizard ex,OBF,Obsidian Flames,125,NearMint,Normal,English,200.00,2025-01-15
My Cards,2,0,Pikachu VMAX,VIV,Vivid Voltage,44,LightlyPlayed,Foil,English,60.00,2025-01-15
```

`deckbox.csv`:
```
Count,Name,Edition,Card Number,Condition,Language,Foil,My Price
1,Charizard ex,Obsidian Flames,125,Near Mint,English,,250.00
2,Pikachu VMAX,Vivid Voltage,44,Good (Lightly Played),English,foil,80.00
```

`tcgplayer-seller.csv`:
```
TCGplayer Id,Product Line,Set Name,Product Name,Title,Number,Rarity,Condition,TCG Market Price,Total Quantity,TCG Marketplace Price
123,Pokemon,Obsidian Flames,Charizard ex,,125,Ultra Rare,Near Mint,220.00,1,250.00
456,Pokemon,Vivid Voltage,Pikachu VMAX,,44,VMAX,Lightly Played,70.00,2,80.00
```

`vendor-freeform.csv`:
```
card,kondisi,harga,qty
Charizard ex,NM,250,1
Pikachu VMAX,LP,80,2
```

- [ ] **Step 2: Write `src/lib/import/__tests__/fixtures.test.ts`**

```typescript
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
    // "harga" (Malay for price) has no alias; should fall through to pattern match on sell_price
    expect(byField.sell_price).toBe("harga");
    // "kondisi" is unknown but values are NM/LP → pattern match on condition
    expect(byField.condition).toBe("kondisi");
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npm test -- fixtures
```

Expected: all passing.

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: everything passes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/import/__fixtures__ src/lib/import/__tests__/fixtures.test.ts
git commit -m "test(import): fixture-based integration tests for 5 formats"
```

---

## Task 18: Smoke test on a real vendor file

Before turning the feature flag on in production, test on at least one real export from each target app. This is a manual checklist — no code changes unless bugs surface.

- [ ] **Step 1: Acquire a real export**

Ask the user for one real file from: ManaBox, Dragon Shield, or TCGplayer Seller (even a small one with 10-20 cards). If unavailable, skip this task and document the limitation.

- [ ] **Step 2: Run the full flow**

With `npm run dev`:
- Upload the real file
- Verify headers are correctly detected on the mapping screen
- Proceed to preview
- Confirm matches look reasonable (most common Pokémon cards should match)
- Import a small subset (use a test vendor account, not real inventory)
- Verify inventory row appears in DB with correct fields

- [ ] **Step 3: File issues for any bugs surfaced**

If bugs are found, add tasks below for each and resolve before shipping. If the file looks fine, note it in the commit message.

- [ ] **Step 4: Commit (even if no code changed) to document the test was run**

```bash
git commit --allow-empty -m "chore(import): smoke-tested on real <app-name> export"
```

---

## Self-Review Results

**Spec coverage check:**
- ✅ 3-screen flow (upload → mapping → preview) — Tasks 12, 13, 15
- ✅ Papa Parse + SheetJS — Tasks 1, 5
- ✅ `sep=,` + BOM handling — Task 5
- ✅ Condition normalizer — Task 3
- ✅ Grading parser — Task 4
- ✅ Column detector (header + pattern) — Tasks 6, 7
- ✅ `match_cards` RPC + trigram index — Task 8
- ✅ Matcher with batch + classification — Task 9
- ✅ Feature flag — Task 10
- ✅ sessionStorage state — Task 11
- ✅ Batch pricing selector — Task 14
- ✅ CSV template + inventory entry point — Task 16
- ✅ Fixture integration tests — Task 17
- ✅ Manual real-file smoke test — Task 18
- ✅ Row cap + file size cap enforced — Task 5
- ✅ Graded cards using existing 00003 columns — Tasks 4, 9
- ✅ Free tier access — handled by the existing auth/vendor hooks; no additional gate needed at import time because inventory UNIQUE constraint already prevents duplicates. **Gap:** the spec mentions a 50-card cap check for free tier that truncates imports — **not yet in the plan.** See Task 19 below.

**Placeholder scan:** none.
**Type consistency:** spot-checked — `MatchResult`, `ColumnMapping`, `KardVaultField`, `ImportSessionState` all match between types.ts, matcher.ts, pages, and tests.

---

## Task 19: Free-tier 50-card cap enforcement

Covers the spec's "Free-tier access — gated by 50-card inventory cap" requirement that was missing from the initial plan.

**Files:**
- Modify: `src/app/import/preview/page.tsx`

- [ ] **Step 1: Before the import button, compute remaining capacity**

In `PreviewPage`, after `vendor` is loaded, fetch current inventory count:

```typescript
const [currentCount, setCurrentCount] = useState<number | null>(null);

useEffect(() => {
  if (!vendor) return;
  supabase
    .from("inventory")
    .select("id", { count: "exact", head: true })
    .eq("vendor_id", vendor.id)
    .then(({ count }) => setCurrentCount(count ?? 0));
}, [vendor]);

const isFreeTier = vendor?.tier === "free";
const FREE_CAP = 50;
const remainingCapacity = isFreeTier && currentCount !== null ? Math.max(0, FREE_CAP - currentCount) : Infinity;
const willTruncate = counts.matched > remainingCapacity;
const toImportCount = Math.min(counts.matched, remainingCapacity);
```

- [ ] **Step 2: Show an upsell card when truncation would happen**

Before the import button:

```tsx
{willTruncate && (
  <div className="mt-4 rounded-lg border border-primary-600 bg-primary-800/40 p-3 text-sm">
    <div className="mb-1 font-medium text-primary-200">Free tier holds 50 cards</div>
    <div className="text-xs text-text-secondary">
      You have {currentCount} cards. Importing will add the first {remainingCapacity} matched cards.
      {" "}
      <Link href="/upgrade" className="underline">Upgrade to Pro</Link> for unlimited.
    </div>
  </div>
)}
```

- [ ] **Step 3: Truncate the rows inserted in `handleImport`**

Change the matched filter to slice to `remainingCapacity`:

```typescript
const matched = state.matchResults
  .filter((r) => r.status === "matched" && r.selectedCardId)
  .slice(0, remainingCapacity);
```

Update the button label to `toImportCount`:

```tsx
{importing ? "Importing…" : `Import ${toImportCount} matched cards`}
```

- [ ] **Step 4: Manual verification**

Create a free-tier vendor with 45 inventory rows. Upload a 20-row CSV → preview shows 20 matched but upsell says "first 5 will import". Import → inventory reaches 50, rest skipped.

- [ ] **Step 5: Commit**

```bash
git add src/app/import/preview/page.tsx
git commit -m "feat(import): free-tier 50-card cap with upsell"
```
