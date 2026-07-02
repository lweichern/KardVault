# Tiered Scan Waterfall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Gemini-first scan pipeline with the CLAUDE-enhance.md tiered identification waterfall (pHash → OCR → Gemini extraction → human confirm), plus capture-pipeline upgrades and Pro-tier video auto-scan.

**Architecture:** Client captures a guide-aligned frame, detects/warps the card to a canonical crop, computes perceptual hashes and an identifier-strip crop, and sends all of it to the server. The server runs tiers in order — in-memory Hamming NN over `card_hashes` (Tier 1), Google Cloud Vision OCR on the strip (Tier 2), Gemini two-crop structured *extraction* (never identification) (Tier 3) — stopping at the first confident result and always returning top-3 candidates for the confirm UI (Tier 4). Every scan logs to `scan_events`; every human correction logs to `scan_corrections`. All matching goes through a pluggable `CatalogProvider` (Pokémon first) so MTG/YGO/Riftbound plug in later.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RLS), TypeScript strict, Vitest (happy-dom), pure-TS image math (no OpenCV.js), Google Cloud Vision REST (env-gated), `@google/generative-ai`, `sharp` (script/server only).

## Global Constraints

- Never ask the AI "what card is this?" — extraction of identifiers only; matching is deterministic against our catalog (spec §1).
- Never silently insert a low-confidence match; confirm UI is the safety net (spec §2 Tier 4).
- pHash auto-accept thresholds: `T_accept = 10`, `T_margin = 6` on 64-bit hashes (spec §2 Tier 1).
- Tier 3 sends two crops (full card + zoomed identifier strip), strict JSON schema, `null` for illegible fields (spec §2 Tier 3).
- Video mode never sends video to any API — frame selection only; Pro-tier gated (spec §4).
- Image-math modules must not require DOM canvas (tests run in happy-dom): operate on `{ width, height, data: Uint8ClampedArray }`.
- TypeScript strict; Tailwind-only styling; existing dark-theme token classes (`bg-bg-surface`, `text-text-primary`, `primary-400`, etc.).
- Catalog `cards.number` stores the raw pokemon-tcg-data number (`"25"`, `"TG15"`, `"SV045"`); printed totals live in `card_sets.printed_total`/`total`. OCR `"123/198"` parses to `{ number: "123", setTotal: 198 }` and joins on both.
- New env vars (all optional, tier degrades gracefully): `GOOGLE_VISION_API_KEY` (Tier 2). Existing: `GEMINI_API_KEY`/`VISION_PROVIDER` (Tier 3).

---

### Task 1: Migration 00008 + DB types

**Files:**
- Create: `supabase/migrations/00008_scan_waterfall.sql`
- Modify: `src/types/database.ts` (add `card_hashes`, `scan_events`, `scan_corrections` table types)

Tables per spec §7, adapted: hashes stored as 16-char hex TEXT (not bytea — supabase-js bytea round-tripping is error-prone; Hamming runs in JS anyway). `scan_events` gains `auto_accepted BOOLEAN` and `candidates JSONB` for calibration. RLS: `card_hashes` public read (reference data, written by service-role script); `scan_events`/`scan_corrections` vendor-owned insert/select (service role bypasses for server writes).

```sql
create table card_hashes (
  game text not null default 'pokemon',
  card_id text not null references cards(id) on delete cascade,
  printing_id text not null default '',
  hash_full text not null,   -- 16 hex chars = 64-bit pHash
  hash_art text,
  updated_at timestamptz default now(),
  primary key (game, card_id, printing_id)
);
create table scan_events (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid references vendors(id) on delete cascade,
  session_id uuid,
  mode text check (mode in ('photo','video','flatlay','quick')),
  tier_resolved int,
  auto_accepted boolean not null default false,
  hash_best_distance int,
  hash_margin int,
  ocr_parsed boolean,
  gemini_called boolean not null default false,
  resolved_card_id text references cards(id),
  candidates jsonb,
  latency_ms integer,
  created_at timestamptz default now()
);
create table scan_corrections (
  id uuid primary key default gen_random_uuid(),
  scan_event_id uuid references scan_events(id) on delete cascade,
  candidates_shown jsonb,
  chosen_card_id text not null references cards(id),
  created_at timestamptz default now()
);
```

**Produces:** `Database["public"]["Tables"]["card_hashes" | "scan_events" | "scan_corrections"]`.

---

### Task 2: `src/lib/scan/phash.ts` — perceptual hash (Tier 1 math)

**Files:** Create `src/lib/scan/phash.ts`, `src/lib/scan/__tests__/phash.test.ts`, `src/lib/scan/raw-image.ts`

**Interfaces (produced):**
```ts
// raw-image.ts — structural subset of ImageData, canvas-free
export interface RawImage { width: number; height: number; data: Uint8ClampedArray }
export function toGrayscale(img: RawImage): Float64Array
export function resampleGray(gray: Float64Array, w: number, h: number, outW: number, outH: number): Float64Array // area-average
export function cropRaw(img: RawImage, x: number, y: number, w: number, h: number): RawImage

// phash.ts
export function phash(img: RawImage): string            // 64-bit pHash as 16 hex chars: 32×32 gray → DCT-II → 8×8 low-freq (skip DC) → median threshold
export function hammingHex(a: string, b: string): number // 0..64
```

Tests: identical image → distance 0; brightness-shifted copy → distance ≤ 6; random noise vs. gradient → distance ≥ 20; hex format `^[0-9a-f]{16}$`; hamming symmetric & known-bit cases.

---

### Task 3: `src/lib/scan/geometry.ts` — homography + perspective warp

**Files:** Create `src/lib/scan/geometry.ts`, `src/lib/scan/__tests__/geometry.test.ts`

**Interfaces (produced):**
```ts
export interface Point { x: number; y: number }
export const CARD_W = 512; export const CARD_H = 716; // 63:88 aspect
export function solveHomography(src: Point[4], dst: Point[4]): number[] // 3×3 row-major, maps dst→src for inverse sampling
export function warpPerspective(img: RawImage, corners: Point[4], outW?: number, outH?: number): RawImage // bilinear sample
export function orderCorners(pts: Point[]): Point[4] // TL,TR,BR,BL by angle around centroid
```

Tests: identity quad round-trips pixels; axis-aligned sub-rect warp equals crop; solveHomography on known affine maps corners exactly; orderCorners on shuffled input.

---

### Task 4: `src/lib/scan/detect.ts` — quad detection + quality gates

**Files:** Create `src/lib/scan/detect.ts`, `src/lib/scan/__tests__/detect.test.ts`

**Interfaces (produced):**
```ts
export interface QuadResult { corners: Point[4]; score: number } // score 0..1 = edge support
export function detectCardQuad(img: RawImage): QuadResult | null
// Downscale to ≤320px wide → Sobel magnitude → Otsu threshold → per-side edge trace:
// for each of 4 sides scan inward for the strongest straight edge (RANSAC-lite line fit
// on edge points in each border band) → intersect lines → quad. Reject if area < 25%
// of frame, aspect outside 0.55..0.95, or any corner outside frame. null = caller
// falls back to the framing-guide rectangle (user aligned the card).
export function blurScore(img: RawImage): number          // Laplacian variance (reuse math style from vision/quality.ts)
export function glareScore(img: RawImage): number          // fraction of pixels with luma > 250 in blown clusters
export const BLUR_MIN = 100;                               // spec §3 starting threshold, on warped crop
export const GLARE_MAX = 0.18;                             // strip fraction blown → "Tilt the card slightly"
```

Tests: synthetic bright rotated rectangle on dark bg → corners within 3px (downscaled space); blank frame → null; blurScore higher on checkerboard than flat; glareScore ~1 on white image, ~0 on mid-gray.

---

### Task 5: `src/lib/catalog/` — CatalogProvider + Pokémon provider

**Files:** Create `src/lib/catalog/types.ts`, `src/lib/catalog/pokemon.ts`, `src/lib/catalog/index.ts`, `src/lib/catalog/__tests__/pokemon.test.ts`

**Interfaces (produced, spec §6 shape adapted to codebase):**
```ts
export type Game = "pokemon" | "mtg" | "yugioh" | "riftbound";
export interface CropSpec { key: "identifier" | "art"; x: number; y: number; w: number; h: number } // fractions of canonical card
export interface ParsedId { number?: string; setTotal?: number; setCode?: string; passcode?: string; raw: string }
export interface CatalogProvider {
  game: Game;
  identifierRegions(): CropSpec[];       // pokemon: identifier = {x:0.03,y:0.90,w:0.62,h:0.08}; art = {x:0.09,y:0.11,w:0.82,h:0.36}
  parseIdentifier(ocrText: string): ParsedId | null;
  lookup(parsed: ParsedId, db: SupabaseClient<Database>): Promise<Card[]>;
  fuzzyLookup(fields: { name?: string|null; number?: string|null; setTotal?: number|null }, db): Promise<Card[]>;
}
export function getCatalogProvider(game: Game): CatalogProvider
```

Pokémon `parseIdentifier` regexes (spec §6, extended for promos/galarian gallery):
```ts
/([A-Z]{0,3}\d{1,3})\s*\/\s*([A-Z]{0,3}\d{1,3})/   // "123/198", "TG15/TG30", "GG56/GG70"
/\b(SVP|SWSH|SM|XY|BW|HGSS|DP)\s?(\d{2,3})\b/i      // promo numbers → number = e.g. "SVP123" normalized per set convention
```
`lookup`: strip leading zeros from parsed number; query `cards.number ilike` both raw and stripped; if `setTotal` present, join `card_sets` on `printed_total = setTotal OR total = setTotal` to filter. `fuzzyLookup`: RPC `match_cards(p_name, null, p_number_hint)` (existing fn) plus number-filtered fallback.

Tests: all regex cases above, zero-strip ("025/198" → "25" matches), promo formats, garbage → null.

---

### Task 6: `src/lib/ocr/` — Tier 2 OCR provider

**Files:** Create `src/lib/ocr/types.ts`, `src/lib/ocr/google-vision.ts`, `src/lib/ocr/index.ts`, `src/lib/ocr/__tests__/google-vision.test.ts`

**Interfaces (produced):**
```ts
export interface OcrProvider { name: string; readText(imageBase64: string): Promise<string | null> }
export function getOcrProvider(): OcrProvider | null // null when GOOGLE_VISION_API_KEY unset → Tier 2 skipped
```
Google impl: `POST https://vision.googleapis.com/v1/images:annotate?key=...` with `TEXT_DETECTION`, return `fullTextAnnotation.text`. 3s timeout via AbortSignal; errors → null (fall through, never throw into the waterfall). Tests: mocked fetch happy path, API error → null, missing key → provider null.

---

### Task 7: `src/lib/vision/` — Tier 3 restructure (two-crop structured extraction)

**Files:** Modify `src/lib/vision/types.ts`, `src/lib/vision/prompts.ts`, `src/lib/vision/gemini.ts`, `src/lib/vision/openai.ts`, `src/lib/vision/anthropic.ts`; Create `src/lib/vision/__tests__/parse.test.ts`, `src/lib/vision/parse.ts`

**Interfaces (produced):**
```ts
export interface ExtractionResult {
  game_guess: "pokemon" | "mtg" | "yugioh" | "riftbound" | "unknown";
  card_name: string | null;
  collector_number: string | null;
  set_code: string | null;
  set_total: string | null;
  passcode: string | null;
  language: "EN" | "JP" | "other" | null;
  visible_text_fragments: string[];
  confidence: "high" | "medium" | "low";
  is_graded: boolean;                    // keep existing slab support — not a new capability
  grading_company: string | null;
  grade: string | null;
  cert_number: string | null;
}
export interface VisionProvider { name: string; extract(imagesBase64: string[]): Promise<ExtractionResult> }
export function parseExtractionJson(text: string): ExtractionResult // strips fences, validates enums, nulls unknowns
```
`EXTRACTION_PROMPT` = spec §2 Tier 3 prompt verbatim + grading-slab addendum. All three providers accept multiple images. Legacy `ScanResult`/`SINGLE_CARD_PROMPT` deleted (route is rewritten in Task 9; no other consumers — verify with grep). Tests: fenced JSON, bare JSON, invalid enum coerced to "unknown"/"low", missing fields → null/[].

---

### Task 8: `src/lib/scan/waterfall.ts` + `src/lib/scan/hash-index.ts` — orchestration

**Files:** Create `src/lib/scan/waterfall.ts`, `src/lib/scan/hash-index.ts`, `src/lib/scan/__tests__/waterfall.test.ts`

**Interfaces (produced):**
```ts
// hash-index.ts — module-level cache, lazy-loaded from card_hashes (18.5K rows ≈ trivial linear scan)
export interface HashHit { cardId: string; distance: number; artDistance: number | null }
export function nearestByHash(hashFull: string, hashArt: string | null, k: number): Promise<HashHit[]>
export function invalidateHashIndex(): void

// waterfall.ts
export const T_ACCEPT = 10; export const T_MARGIN = 6;
export interface ScanInput { imageFull: string; imageStrip?: string; hashFull?: string; hashArt?: string }
export interface WaterfallResult {
  card: Card | null;                 // best candidate (auto-accepted or top suggestion)
  candidates: Card[];                // top ≤3 with thumbnails for Tier 4 UI
  autoAccepted: boolean;
  tierResolved: 1 | 2 | 3 | 4 | null;
  telemetry: { hashBestDistance: number|null; hashMargin: number|null; ocrParsed: boolean; geminiCalled: boolean };
}
export function runWaterfall(input: ScanInput, deps: WaterfallDeps): Promise<WaterfallResult>
```
Tier rules implemented exactly as spec §2: T1 auto-accept needs `best ≤ T_ACCEPT && (second − best) ≥ T_MARGIN` **and** art-hash agreement when both hashes present; ambiguous T1 carries top-5 as priors. T2 accepted when OCR lookup is a unique catalog match OR agrees with T1 top (highest confidence). T3 only when T1 ambiguous AND T2 unreadable/disagreeing; match via `fuzzyLookup` filtered by priors — agreement between signals decides, never Gemini's confidence alone. Anything unresolved → `tierResolved: 4|null`, `autoAccepted: false`, candidates = union of tier suggestions. `WaterfallDeps` injects `{ hashSearch, ocr, vision, catalog, db }` so tests fake every tier: 10+ scenario tests (T1 clean accept, margin fail → T2, T1/T2 agree, disagree → T3, all fail → candidates only, no-hash input skips T1, missing OCR key skips T2, etc.).

---

### Task 9: API routes — rewrite identify + add correction

**Files:** Modify `src/app/api/scan/identify/route.ts`; Create `src/app/api/scan/correction/route.ts`

`POST /api/scan/identify` body: `{ items: ScanInput[]; mode: 'photo'|'video'|'quick'; sessionId?: string }` (≤10 items). Auth unchanged. Runs `runWaterfall` per item concurrently, inserts one `scan_events` row per item (service client, awaited-but-nonblocking pattern kept), returns `{ results: [{ ...WaterfallResult-serialized, scanEventId }] }`.
`POST /api/scan/correction` body: `{ scanEventId, chosenCardId, candidatesShown: string[] }` → inserts `scan_corrections`, updates the event row (`vendor_corrected` semantics via `resolved_card_id`). Both vendor-authenticated.

---

### Task 10: Client capture pipeline

**Files:** Create `src/lib/scan/capture.ts` (client-only); Modify `src/hooks/use-camera.ts` (no API change needed — keeps returning full-frame ImageData)

**Interfaces (produced):**
```ts
export interface CaptureArtifacts {
  fullBase64: string;    // warped 512×716 crop, jpeg
  stripBase64: string;   // identifier region upscaled 2× (≈5× effective zoom vs. full photo)
  hashFull: string; hashArt: string;
  quality: { ok: true } | { ok: false; reason: string }; // blur gate on crop, glare gate on strip
}
export function processCapture(frame: ImageData, guideRect: {x,y,w,h}): CaptureArtifacts
```
Flow: crop to guide rect (+8% margin) → `detectCardQuad` → warp (fallback: guide rect as quad) → blur gate (`BLUR_MIN`, "Hold steady") → strip crop via `getCatalogProvider('pokemon').identifierRegions()` → glare gate ("Tilt the card slightly") → pHashes → jpeg encode via canvas. Canvas encode isolated in one helper so everything upstream stays unit-testable.

---

### Task 11: Scan page — new pipeline + Tier 4 confirm UI

**Files:** Modify `src/app/(vendor)/scan/page.tsx`; Create `src/components/candidate-picker.tsx`

- Both single + quick capture paths call `processCapture` and send the new `items` payload; gate failures toast the specific reason and stay live.
- Single mode: `autoAccepted` → straight to AddCardModal (current behavior). Not auto-accepted with candidates → `CandidatePicker` (top-3 thumbnails, one-tap select, "None of these — search" fallback). Every pick where `card.id !== result.card?.id` or from search → fire-and-forget `POST /api/scan/correction`.
- Quick mode result rows: unmatched/uncertain rows render the same top-3 candidate strip inline before the search fallback; corrections logged identically.
- "identifying…" stays async/non-blocking (spec §3.5) — capture returns to live camera immediately in quick mode.

---

### Task 12: `scripts/hash-catalog.ts` — catalog hashing job

**Files:** Create `scripts/hash-catalog.ts`; Modify `package.json` (add `sharp` dep + `"hash:catalog": "tsx scripts/hash-catalog.ts"`)

Service-role script: page through `cards` (id, image_small, image_large), skip ids already in `card_hashes` (resumable), fetch image (prefer small — 245×342 is plenty for 32×32 pHash), `sharp(...).raw()` → `RawImage` → `phash` full + art-region crop → upsert batches of 200, concurrency 8, progress log every 500. `--force` flag rehashes all. Exits non-zero listing failed ids.

---

### Task 13: Video auto-scan mode (Pro)

**Files:** Create `src/hooks/use-video-scan.ts`, `src/lib/scan/beep.ts`; Modify `src/app/(vendor)/scan/page.tsx` (third mode tab "Video · Pro")

Loop per spec §4: rAF-throttled ~10fps frame grabs → `detectCardQuad` on ≤320px downscale → stability gate (corner drift < 2% for ≥400ms, quad ≥50% of guide area, blur + strip-glare pass) → burst-capture 3 frames → `processCapture` each → one identify call with 3 items → majority vote on `card.id` (2-of-3; else treat as not-auto-accepted, queue for confirm) → WebAudio beep + prepend to session list → suppress re-trigger while `hammingHex(newHash, anyAcceptedHashInLast5s) ≤ 8`. Session list reuses quick-mode results panel (add-all + candidate correction). Gate: `vendor.tier !== 'pro'` shows lock state on the tab. Free tier keeps photo modes (spec §8).

---

### Task 14: Verification

- `npm test` — all new suites green (phash, geometry, detect, pokemon parser, ocr, extraction parse, waterfall).
- `npx tsc --noEmit`, `npm run lint`, `npm run build` clean.
- `.env.example`: add `GOOGLE_VISION_API_KEY=` with comment.
- Commit sequence: migration+types → scan math libs → catalog/ocr/vision → waterfall+routes → client capture+UI → hash script → video mode.

## Deferred to follow-up plans (spec §9 Phases 4–5)

- **Snap & Sell** (spec §5): separate subsystem (flat-lay detection, pricing waterfall incl. TCGCSV + forex, render template, share sheet). Depends on this plan's waterfall + a sealed-product catalog that doesn't exist yet.
- **Multi-game catalogs** (spec §6): the `CatalogProvider` seam ships now; Scryfall/YGOPRODeck/Riftbound ingestion are data jobs layered on it.
