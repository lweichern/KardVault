# CSV/Excel Inventory Import — Design

**Date:** 2026-04-17
**Status:** Draft
**Phase:** 2 (Beta)

---

## Problem

Malaysian TCG vendors already track inventory in spreadsheets (Excel, Google Sheets) or in competitor apps (ManaBox, Dragon Shield, TCGplayer, Deckbox, Collectr, Shiny). Asking them to re-scan every card to migrate is a non-starter. We need CSV/Excel import that:

- Handles messy real-world files (inconsistent headers, mixed case, trailing whitespace, BOM, Dragon Shield's `sep=,` prefix)
- Accepts exports from any of the top 5-6 competitor apps without manual column mapping in the common case
- Falls back to a manual mapping UI when auto-detection fails
- Matches imported card names against our local `cards` table using fuzzy search
- Gives the vendor a clear review step before anything is written to inventory

---

## Goals

- Vendor can drop a CSV/XLSX and get 80%+ of cards into inventory in under 2 minutes
- Zero server-side file processing — parsing runs entirely in the browser (privacy + cost)
- Support the seven most common formats: ManaBox, Dragon Shield, Deckbox, TCGplayer Seller, Collectr, Shiny, and freeform vendor spreadsheets
- Column auto-detection succeeds for at least 80% of columns across these formats
- Always show a preview step — never silently write to inventory

## Non-Goals (v1)

- Foil/printing field (Pokémon has holo/reverse-holo/etc. that matter; deferred as a separate feature that also touches scan flow)
- Server-side fallback for huge files — client-side is adequate up to ~10K rows
- Multi-file import
- Currency conversion — v1 assumes imported prices are in RM. Users with USD spreadsheets need to convert before import.
- Merge-into-existing-inventory logic beyond the existing UNIQUE constraint on `(vendor_id, card_id, condition, grading_company, grade)`

---

## User Flow (3 screens)

### Screen 1 — Upload (`/import`)

- Dashed drop zone; accepts `.csv` and `.xlsx`
- On file selected: parse headers + first 5 rows client-side, show filename + "124 rows · 6 columns · 18 KB"
- Secondary action: "Download KardVault CSV template" (static file `/public/templates/kardvault-template.csv`)
- Primary CTA: "Continue to column mapping"

### Screen 2 — Column mapping (`/import/mapping`)

- One card per detected CSV column showing:
  - Auto-detected status (✅ green checkmark, 🟣 uncertain, ⚫ skipped)
  - Column label + first 3 sample values
  - Dropdown to assign the KardVault field (or skip)
- Top-right count: "4 of 6 auto-detected"
- KardVault fields in the dropdown: `Card name`, `Set`, `Card number`, `Sell price`, `Buy price`, `Condition`, `Quantity`, `Grading` (combined PSA/BGS + grade), `Skip`
- Primary CTA: "Match N cards against database"
- Requires `Card name` to be mapped — disable CTA otherwise

### Screen 3 — Match preview (`/import/preview`)

- Summary row: matched / uncertain / not found counts
- Filter chips: All / Matched / Uncertain / Not found
- List shows each CSV row with:
  - ✅ Matched (green, similarity ≥ 0.7): card image, name, set, confidence %
  - 🟡 Uncertain (0.4–0.7): "Zard ex → Charizard ex?" with confidence %, tap to confirm or search
  - ❌ Not found (< 0.4): "No match in database — tap to search manually"
- Before the final CTA, show a **batch pricing rule** selector:
  - At market (default)
  - 90% of market
  - 80% of market
  - Custom multiplier (0.5 – 2.0)
  - Note: this applies ONLY when the imported CSV did not provide a sell price column. If sell price was mapped, per-row prices are used.
- Primary CTA: "Import N matched cards" (only the confirmed-matched count imports; uncertain + not-found are skipped with a visible explanation)

---

## Architecture

### File layout

```
src/
  app/
    import/
      page.tsx                    # upload screen
      mapping/page.tsx            # column mapping screen
      preview/page.tsx            # match preview + import action
  lib/
    import/
      parser.ts                   # Papa Parse + SheetJS wrappers
      column-detector.ts          # header + data-pattern auto-detection
      matcher.ts                  # fuzzy card name → cards table match
      condition-normalizer.ts     # maps freeform condition strings to NM/LP/MP/HP/DMG
      types.ts                    # shared types (ParsedFile, ColumnMapping, MatchResult)
  components/
    import/
      upload-dropzone.tsx
      column-mapping-row.tsx
      match-result-row.tsx
      batch-pricing-selector.tsx
public/
  templates/
    kardvault-template.csv
```

### State persistence across screens

Screen-to-screen state uses **sessionStorage** (keyed by a random `importId`), not URL params. Parsed rows and mappings can be large. Cleared on successful import or on navigating back to `/import`.

### Dependencies to add

```
papaparse        ^5.4.1
@types/papaparse ^5.3.14
xlsx             ^0.18.5  (SheetJS community build)
```

---

## Parser (`lib/import/parser.ts`)

- `parseFile(file: File): Promise<ParsedFile>`
- For `.csv`:
  - Read as text, check first line for `sep=,` (Dragon Shield gotcha) — skip if present
  - Strip UTF-8 BOM if present
  - Pass to Papa Parse with `{ header: true, skipEmptyLines: true, dynamicTyping: false }`
  - Keep everything as strings — we'll type-coerce in the matcher
- For `.xlsx`:
  - Read as ArrayBuffer, pass to SheetJS `read(buf, { type: 'array' })`
  - Use first sheet, convert to JSON with `sheet_to_json({ header: 1, defval: '' })`
  - First row = headers, rest = data rows
- Return shape:
  ```ts
  type ParsedFile = {
    headers: string[];                   // trimmed, original case preserved
    rows: Record<string, string>[];      // keyed by header
    rowCount: number;
    fileName: string;
    sizeBytes: number;
  };
  ```

---

## Column detector (`lib/import/column-detector.ts`)

Two-pass detection. Header matching first (fast, high confidence); data-pattern fallback only for unmatched columns.

### Expanded alias dictionary (research-updated)

```ts
const ALIASES: Record<KardVaultField, string[]> = {
  card_name: [
    'name', 'card name', 'card', 'item', 'product', 'card_name',
    'product name', 'item name'
  ],
  set: [
    'set', 'set name', 'expansion', 'series', 'edition', 'set code', 'set_code'
  ],
  card_number: [
    'number', 'card number', 'no', '#', 'card_number',
    'collector number', 'collector_number'
  ],
  sell_price: [
    'price', 'sell price', 'sell', 'my price', 'tcg marketplace price',
    'marketplace price', 'asking price'
  ],
  buy_price: [
    'buy price', 'cost price', 'purchase price', 'paid',
    'price bought', 'purchase_price', 'cost'
  ],
  condition: ['condition', 'cond', 'quality'],
  quantity: [
    'qty', 'quantity', 'count', 'amount',
    'total quantity', 'add to quantity', 'tradelist count'
  ],
  grading: ['grade', 'grading', 'graded', 'grader'],
};
```

Matching is case-insensitive, whitespace-collapsed, punctuation-stripped.

### Data-pattern fallback

Applied only to columns that header-matching didn't claim:

- **card_number:** column where ≥80% of values match `/^\d{1,4}(\/\d{1,4})?$/` OR `/^[A-Z]{1,4}\d{1,4}(-\d{1,4})?$/` (handles `25`, `025/198`, `TG15`, `SV1-025`)
- **price fields:** column where ≥80% of values parse as positive floats between 0.01 and 100000
- **condition:** column where ≥70% of values match a known condition alias (see normalizer)
- **quantity:** column where ≥90% of values parse as positive integers 1–9999
- **grading:** column where ≥30% of values match `/(PSA|BGS|CGC|ACE|SGC)\s*\d+(\.\d)?/i`

If two columns could both be "sell_price" by pattern, the one with the larger header-alias match wins. If neither has a matching header, ask the user.

### Output

```ts
type ColumnMapping = {
  columnName: string;       // header from CSV
  field: KardVaultField | 'skip';
  confidence: 'header' | 'pattern' | 'manual';
  sampleValues: string[];   // first 3 non-empty values
};
```

---

## Condition normalizer (`lib/import/condition-normalizer.ts`)

Maps any freeform condition string to `NM | LP | MP | HP | DMG | null`.

Algorithm:
1. Lowercase, strip punctuation and whitespace
2. Substring-match against a dictionary:
   ```
   nm / near mint / nearmint / mint → NM
   lp / lightly played / lightlyplayed / good(lightlyplayed) → LP
   mp / moderately played / moderatelyplayed / played → MP
   hp / heavily played / heavilyplayed → HP
   dmg / damaged → DMG
   ```
3. If no match, return `null` and the row falls back to the vendor-selected default (NM, from a dropdown on the preview screen)

Deckbox's `Good (Lightly Played)` matches because after punctuation-strip it becomes `goodlightlyplayed` which contains `lightlyplayed`.

---

## Grading parser (`lib/import/grading-parser.ts`)

Parses a grading cell like `PSA 10`, `BGS 9.5`, `CGC 9`, `ACE 10`, `SGC 8.5` into structured fields.

Algorithm:
1. Uppercase, collapse whitespace
2. Regex: `/^(PSA|BGS|CGC|ACE|SGC)\s*(\d+(?:\.\d+)?)\s*$/`
3. On match, set `grading_company` and `grade` on the inventory row
4. On no match OR empty cell, leave grading fields null (row is treated as raw)

Inventory's UNIQUE constraint `(vendor_id, card_id, condition, COALESCE(grading_company, ''), COALESCE(grade, ''))` naturally separates graded variants from raw — no extra dedup logic needed.

---

## Matcher (`lib/import/matcher.ts`)

For each parsed row:

1. Build a query: `card_name` + optional `set` + optional `card_number`
2. Server-side match via a Postgres RPC `match_cards(name text, set_hint text, number_hint text)`:
   - `WHERE similarity(name, $1) > 0.3`
   - Boost similarity by +0.2 if set_name ILIKE '%' || set_hint || '%'
   - Boost by +0.3 if card_number = number_hint (exact match on printed number)
   - ORDER BY adjusted_similarity DESC LIMIT 3
3. Result classification:
   - Top hit similarity ≥ 0.7 AND no ties → **Matched**
   - Top hit similarity in [0.4, 0.7) OR top-2 within 0.05 of each other → **Uncertain** (show top 3 candidates)
   - Top hit similarity < 0.4 → **Not found** (show "search manually" with a card-search modal)
4. Batched — send rows in chunks of 50 RPC calls (RPC accepts array input) to keep the preview responsive

The RPC is a new migration; see Schema section.

---

## Schema changes

New migration `00004_import_matching.sql`:

```sql
-- Ensure pg_trgm index exists (already in 00002, but idempotent)
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
    c.id, c.name, c.set_name, c.card_number, c.image_small, c.market_price_rm,
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

GRANT EXECUTE ON FUNCTION match_cards TO authenticated;
```

No `inventory` table changes in this feature.

---

## Sell-price policy

If the mapping included a `sell_price` column, per-row prices are used as-is (converted to RM if needed — see currency note below).

If no sell-price column was mapped, the batch pricing selector on the preview screen determines it:
- At market: `sell_price_rm = card.market_price_rm`
- 90% / 80%: `sell_price_rm = card.market_price_rm * 0.9 | 0.8`
- Custom: vendor-entered multiplier (0.5 – 2.0)

**Currency:** v1 assumes imported prices are already in RM. No in-app conversion. Users with USD-denominated spreadsheets need to convert before import. If real-world usage shows most vendors have USD data, we'll revisit.

---

## Free-tier access

CSV import is available on Free tier, gated by the 50-card inventory cap.

- Import flow runs unrestricted up to the preview screen
- On "Import N cards" click: check `vendor.tier` and current inventory count
- If free tier and `current_count + to_import > 50`, show inline upsell: "Free tier holds 50 cards. Import only the first N, or upgrade to Pro for unlimited."
- Two buttons: "Import first N" (truncates) or "Upgrade to Pro" (navigates to upgrade page)

---

## Error handling

All errors are user-facing and actionable — no silent failures.

| Scenario | Handling |
|---|---|
| File > 5 MB | Reject on upload with "File too large — max 5 MB. Split your file or contact support." |
| File > 5,000 rows | After parsing, reject with "This file has N rows. Max supported is 5,000. Split your file into smaller batches." |
| File is neither .csv nor .xlsx | Reject on upload with "Only CSV and Excel files are supported." |
| Papa Parse/SheetJS throws | Show the parse error verbatim with a "try again" button |
| Zero rows detected | "We couldn't find any data in this file. Is the first row a header?" |
| No `card_name` column mapped | Block the CTA; help text: "We need a card name column to match against our database." |
| RPC fails during matching | Retry once; if still fails, show "Matching service unavailable — please try again in a moment" |
| User navigates away mid-import | sessionStorage persists; returning to `/import` offers "Resume previous import?" for 24 hours |
| Inventory write fails mid-batch | Write in a single `supabase.from('inventory').insert([...])` call — atomic at the row level. If some rows fail (e.g., constraint violation), show which ones and allow retry of just those |

---

## Testing

- **Unit tests** (`lib/import/*.test.ts`):
  - Parser: `sep=,` skip, BOM strip, XLSX-to-rows, empty file, single-column file
  - Column detector: each of the 6 target formats' exact header rows → correct mapping
  - Column detector data-pattern fallback: card-number columns with plain integers, prices, conditions
  - Condition normalizer: `NearMint`, `Near Mint`, `near_mint`, `Good (Lightly Played)`, `NM`, `moderately played` → all map correctly
- **Integration tests**: fixture files (one per competitor app) in `lib/import/__fixtures__/` — assert end-to-end from file bytes → mapping → preview rows
- **Manual test on real files**: get at least one real export from each of ManaBox, Dragon Shield, TCGplayer Seller, and a hand-rolled Excel vendor sheet before claiming done

---

## Decisions log

- **Foil/printing:** deferred. Not in v1 schema — requires separate feature touching scan + inventory + storefront.
- **Sell-price default:** batch pricing selector on preview screen when no sell-price column was mapped.
- **Free tier access:** yes, gated by 50-card cap at import time.
- **Currency:** RM only. No toggle, no conversion. Users with USD data convert manually before import.
- **Graded cards:** supported via dedicated grading parser (`PSA 10`, `BGS 9.5`, etc.). Populates `inventory.grading_company` + `inventory.grade` (existing columns from migration 00003). UNIQUE constraint already handles graded vs raw dedup.
- **Row cap:** 5,000 rows maximum. Files over cap rejected with clear error message.

---

## Rollout

- Merge behind a feature flag (`NEXT_PUBLIC_CSV_IMPORT_ENABLED`) so it can ship dark
- Add link to import from inventory page ("Import CSV" button per existing UI spec in CLAUDE.md)
- No marketing push until at least 5 real vendors have imported successfully on their actual files
- Telemetry: log which source app each import looks like (based on detected headers) so we see which formats we get in the wild
