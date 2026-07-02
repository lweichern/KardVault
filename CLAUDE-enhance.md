# KadVault — Enhancement Spec v2

> Purpose: Upgrade the existing KadVault prototype (Next.js 15 + Supabase PWA) with a reliable
> tiered scanning pipeline, video auto-scan mode, a multi-item price-tag image generator for
> Facebook/WhatsApp group selling, and a pluggable multi-game catalog architecture.
> This spec assumes the existing codebase: card catalog self-hosted from pokemon-tcg-data
> (~18,500 cards), Gemini 2.5 Flash vision scanning, inventory management, QR buyer storefront
> (asking prices hidden from buyers), profit dashboard, Kad Free / Kad Pro (RM19/mo) tiers.

---

## 1. Problem Statement

Current scanning is unreliable because the pipeline sends whole photos to Gemini and asks it to
_identify_ the card. Failures come from:

1. Small text (collector number) becomes ~10–15px after model downscaling → OCR fails.
2. Holo/sleeve glare and blur on capture → unrecoverable input.
3. Freeform identification invites hallucination instead of deterministic lookup.
4. Gemini-first for every frame = high cost, high latency, rate-limit exposure.

**Core architectural principle for everything below:** never ask the AI "what card is this?"
Ask cheap deterministic systems first, extract _identifiers_, and match against our own catalog.
Gemini is a fallback, not the front door.

---

## 2. Tiered Identification Waterfall

Each scan attempt flows through tiers in order. Stop at the first confident result.
Most scans should resolve at Tier 1 or 2 and never touch Gemini.

### Tier 1 — Perceptual Hash Matching (local, ~10ms, free)

**One-time catalog job (per game):**

- Compute perceptual hashes for every card image in the catalog.
- Use `imagehash` (Python) or `blockhash`/pHash port for Node — pick whichever runs in our
  worker environment. Store both:
  - `hash_full`: pHash of the full card image
  - `hash_art`: pHash of the artwork region only (crop the standard art box per game layout)
- Store in a `card_hashes` table: `(game, card_id, printing_id, hash_full, hash_art)`.
- Index for fast Hamming-distance nearest-neighbor lookup (BK-tree in memory, or pg extension;
  catalog sizes are small enough for in-memory).

**At scan time:**

1. Card crop (from Section 4 capture pipeline) → compute pHash of full crop + art-region crop.
2. Nearest-neighbor search against catalog hashes.
3. Confidence rule:
   - `best_distance <= T_accept` AND `(second_best_distance - best_distance) >= T_margin`
     → **auto-accept**.
   - Suggested starting thresholds: `T_accept = 10`, `T_margin = 6` (64-bit pHash).
     Tune per game with real scans; log distances for calibration.
4. If ambiguous → fall to Tier 2, carrying the top-5 hash candidates as priors.

**Why art-region hash matters:** full-art vs regular variants share artwork; full-card hash
disambiguates layout, art hash survives border/foil differences. Compare both, prefer agreement.

### Tier 2 — OCR on Identifier Strip (cheap, fast)

- Crop the **identifier region** per game (see Section 6 layout table) at high resolution.
- Send to Google Cloud Vision `TEXT_DETECTION` (or PaddleOCR self-hosted if we want zero
  external dependency — benchmark both; Cloud Vision is the low-effort default).
- Parse with per-game regex (Section 6). Dictionary lookup against catalog.
- **Agreement rule:** if Tier 1 top candidate == Tier 2 lookup result → auto-accept with
  highest confidence. If they disagree → fall to Tier 3.
- If OCR parse succeeds but Tier 1 was skipped/failed → accept OCR result if the parsed
  identifier is a unique catalog match; otherwise Tier 3.

### Tier 3 — Gemini 2.5 Flash (smart fallback, most expensive)

Only reached when hash is ambiguous AND OCR unreadable (heavy glare, damage, odd angle).

- Send **two crops**, not the whole photo:
  1. Full card crop at moderate resolution (name, art, set symbol)
  2. Zoomed identifier-strip crop (5x effective magnification of the small text)
- Structured extraction prompt — **strict JSON only, no identification**:

```
You are extracting text fields from a trading card photo. Return ONLY valid JSON,
no markdown, no explanation. Schema:
{
  "game_guess": "pokemon" | "mtg" | "yugioh" | "riftbound" | "unknown",
  "card_name": string | null,
  "collector_number": string | null,      // e.g. "123/198", "0057", "LOB-EN005"
  "set_code": string | null,
  "set_total": string | null,
  "passcode": string | null,              // yugioh 8-digit, else null
  "language": "EN" | "JP" | "other" | null,
  "visible_text_fragments": [string],     // any partial legible text
  "confidence": "high" | "medium" | "low"
}
Use null for anything not clearly legible. Do NOT guess identifiers.
```

- Match extracted fields against catalog, fuzzy-matching `card_name`
  (trigram similarity, filtered by any partial identifier and by Tier 1 candidate priors).
- Do not trust Gemini's `confidence` field alone — trust **agreement between signals**
  (name match + partial number + hash prior pointing at the same card).

### Tier 4 — Human Confirm UI (always the safety net)

- Show **top 3 candidates with thumbnails** (from whichever tiers produced candidates),
  one-tap select, plus manual search fallback.
- **Never silently insert a low-confidence match.** A wrong silent match corrupts inventory
  and destroys trust; one tap is acceptable friction.
- **Log every correction** to a `scan_corrections` table:
  `(raw_image_ref, tier_reached, candidates_shown, chosen_card_id, timestamp)`.
  This is our error dataset for threshold tuning and prompt iteration.

### Cost/latency expectations

- Target: 80–90% of clean scans resolve at Tier 1–2 (validate with logging).
- Per-scan Gemini spend drops from "every scan" to a small fallback fraction.
- Tier 1 is instant — required for video-mode UX (Section 4).

---

## 3. Capture Pipeline Upgrades (Photo Mode)

Quality gates BEFORE inference — we control the camera, so fix input upstream:

1. **Framing guide overlay**: card-shaped rectangle in the capture UI; user aligns card.
2. **Card boundary detection + perspective warp**: OpenCV.js contour detection on the
   captured frame → warp to a canonical flat rectangle. All downstream tiers consume the
   warped crop, never the raw photo.
3. **Blur gate**: variance of Laplacian on the crop; below threshold → prompt retake
   ("Hold steady"). Suggested starting threshold: 100 (tune on-device).
4. **Glare gate on identifier strip**: check brightness/variance in the identifier region;
   blown-out highlights → prompt "Tilt the card slightly."
5. Fire identification **async** — UI shows the card as "identifying…" in the list and
   resolves in place. Never block the camera.

---

## 4. Video Auto-Scan Mode (Pro tier)

Continuous scanning: vendor holds phone, slides cards through frame, hears a beep per card.
Architecture: video is used for **frame selection only** — we never send video to any API.

### Loop

1. `getUserMedia` stream → canvas frame grabs at ~10fps (throttled for thermal/battery).
2. Per frame, local detection (OpenCV.js contours or tiny TF.js model): is there a card
   rectangle, where, how large. No identification here.
3. **Stability + quality gating** — trigger capture only when ALL pass:
   - Rectangle stationary ≥ 300–500ms
   - Rectangle fills ≥ X% of guide area
   - Blur score passes
   - Identifier strip not glare-blown
4. **Burst capture**: grab 3 consecutive frames, warp-crop each, run the waterfall on each,
   **majority-vote** the result. Voting kills transient glare/blur failures.
5. On success: beep + card appears in session list. Async resolution as in photo mode.
6. **Dedup**: pHash the accepted crop; suppress re-identification of near-identical crops
   for ~5 seconds so the same card isn't double-counted while the vendor moves it away.

### PWA constraints

- Test iOS Safari early: camera resolution quirks + WASM performance are the known risks.
- Meter API usage per session; video mode is a natural **Pro-tier gate**
  (Free = photo mode, Pro = video mode).

---

## 5. Multi-Item Price-Tag Image Generator ("Snap & Sell")

**Goal:** vendor lays out up to ~10–12 items flat, snaps one photo, gets back a branded image
with a price badge on every item — ready to post to FB groups/WhatsApp. Kills the 15-minute
Canva workflow per sales post.

### Flow

1. **Snap flat-lay** (design guidance in UI: "lay items flat, no overlap, good light").
2. **Detect items**: two options, implement (a) first:
   - (a) Local rectangle/box detection → crop each item → run each crop through the
     existing single-item waterfall. More accurate, more calls, calls are cheap tiers first.
   - (b) Single Gemini call with bounding-box detection returning boxes + IDs. Faster,
     less accurate. Keep as an experiment flag.
3. **Sealed product identification**: sealed is EASIER than singles — box art is a
   logo-recognition problem, large and glare-tolerant. For sealed, Tier 1 hashing against a
   sealed-product image catalog (TCGCSV product images) will carry most of the load.
   **Critical:** force variant precision — Gemini prompt and catalog matching must resolve
   `product_type` (booster box / bundle / ETB / tin / blister) and `language` (EN/JP),
   because prices differ wildly between variants.
4. **Confirm/correct screen** (mandatory, never auto-post):
   - Each detected item shown with matched card/product thumbnail + editable price field.
   - Prices pre-filled via the Pricing Waterfall (Section 5.1).
   - Tap any item to fix a mismatch (top-3 candidates or search).
5. **Render** via existing Playwright HTML-to-image pipeline:
   - Original photo as background
   - Price badge positioned at each item's bounding box
   - Optional footer: "DM to buy" + vendor handle
   - **Free tier: "made with KadVault" watermark** (this watermark is the viral loop —
     every sales post in a WhatsApp group is an ad). **Pro: clean export.**
6. **Share sheet** → FB / WhatsApp / save.

### 5.1 Pricing Waterfall (per item, pre-fill order)

1. **Vendor's own asking price** if the item already exists in their KadVault inventory
   (match by card_id/product_id). This is the killer integration — only an inventory
   platform can do this. Label: "your listed price".
2. **TCGCSV/TCGplayer market price** (categoryId 3 = Pokémon, 89 = Riftbound; add MTG/YGO
   category IDs when those games ship) × **forex rate** (USD→MYR, cached daily) ×
   **vendor premium slider** (default 1.0, persisted per vendor).
   Label: "suggested from TCGplayer".
3. **Manual entry** if neither exists.

- Currency: MYR default; make currency a vendor setting for SEA expansion (SGD next).
- Do NOT build Carousell/Shopee scraping for v1 — fragile, defer.

---

## 6. Multi-Game Catalog Architecture

Pluggable `CatalogProvider` interface per game. The waterfall stays identical; only data
ingestion and matching rules vary.

```ts
interface CatalogProvider {
  game: "pokemon" | "mtg" | "yugioh" | "riftbound";
  syncCatalog(): Promise<void>; // ingest images + metadata
  identifierRegions(): CropSpec[]; // where to crop for OCR
  parseIdentifier(ocrText: string): ParsedId | null; // per-game regex
  lookup(parsed: ParsedId): CardMatch[]; // deterministic catalog lookup
  autoAcceptPolicy(): AcceptPolicy; // per-game confidence rules
}
```

| Game      | Image catalog source                                                      | Primary identifier                                                 | Identifier location               | Notes / matching rules                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pokémon   | pokemon-tcg-data (existing, ~18.5K)                                       | collector number + set total (`123/198`) + set code                | bottom strip                      | Cleanest case. Hash-alone auto-accept allowed.                                                                                                                                                                |
| MTG       | **Scryfall bulk data** (free, high-res, all printings)                    | collector number + set code                                        | bottom-left                       | Heavy reprint density: same art across many printings, price is printing-specific. **Auto-accept requires hash + OCR agreement on the printing.** Pre-~2014 cards lack collector numbers → hash + confirm UI. |
| Yu-Gi-Oh  | YGOPRODeck API (free, full DB)                                            | set code (`LOB-EN005`, mid-right) + 8-digit passcode (bottom-left) | mid-right + bottom-left           | Passcode is a unique numeric ID — OCR dream. Reprint art common → set code disambiguates. Rarity variants (same card/set, different foil) affect price but not hash/text → push to confirm UI / vendor.       |
| Riftbound | TCGCSV (categoryId 89) images + **self-maintained ingestion per new set** | collector number                                                   | bottom-left (existing, confirmed) | No Scryfall-equivalent; we own catalog completeness. Small catalog = fewer hash collisions = hashing MORE accurate when images exist. Few reprints (young game).                                              |

**Rollout order:** Pokémon (upgrade existing) → Riftbound (already planned) → MTG
(nearly free thanks to Scryfall) → Yu-Gi-Oh.

Per-game regexes (starting points, refine against real OCR output):

- Pokémon: `/(\d{1,3})\s*\/\s*(\d{1,3})/` + set code token
- MTG: `/(\d{1,4})\s*[\/·]?\s*(\d{1,4})?\s+([A-Z0-9]{3,5})/`
- Yu-Gi-Oh set code: `/[A-Z0-9]{2,5}-[A-Z]{2}\d{3}/` ; passcode: `/\b\d{8}\b/`
- Riftbound: use existing confirmed bottom-left format.

---

## 7. Data Model Additions (Supabase)

```sql
-- perceptual hash index per catalog card/printing
create table card_hashes (
  game text not null,
  card_id text not null,
  printing_id text,
  hash_full bytea not null,
  hash_art bytea,
  primary key (game, card_id, printing_id)
);

-- every scan attempt, for calibration + analytics
create table scan_events (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid references vendors(id),
  session_id uuid,
  mode text check (mode in ('photo','video','flatlay')),
  tier_resolved int,             -- 1..4, null = failed
  hash_best_distance int,
  hash_margin int,
  ocr_parsed boolean,
  gemini_called boolean,
  resolved_card_id text,
  created_at timestamptz default now()
);

-- human corrections = error dataset
create table scan_corrections (
  id uuid primary key default gen_random_uuid(),
  scan_event_id uuid references scan_events(id),
  candidates_shown jsonb,
  chosen_card_id text not null,
  created_at timestamptz default now()
);

-- snap & sell posts
create table sell_posts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid references vendors(id),
  source_image_url text,
  rendered_image_url text,
  items jsonb,                   -- [{bbox, card_id/product_id, price, price_source}]
  watermarked boolean,
  created_at timestamptz default now()
);
```

---

## 8. Tier Gating (Free vs Pro RM19/mo)

| Feature                           | Kad Free                             | Kad Pro         |
| --------------------------------- | ------------------------------------ | --------------- |
| Photo scan (waterfall)            | ✅ (50-card inventory cap, existing) | ✅ unlimited    |
| Video auto-scan                   | ❌                                   | ✅              |
| Snap & Sell image                 | ✅ with watermark                    | ✅ clean export |
| Pricing pre-fill from TCGplayer   | ✅                                   | ✅              |
| Multi-game (MTG/YGO when shipped) | Pokémon only                         | All games       |

Watermark-on-Free is deliberate distribution strategy, not just monetization.

---

## 9. Implementation Order

1. **Phase 1 — Reliability core (do first, biggest impact):**
   crop + warp pipeline → Tier 2 OCR bottom-strip lookup → Tier 3 restructured as
   two-crop structured extraction → Tier 4 confirm UI + correction logging.
   _Ship this before hashing — it fixes the current unreliability with the least new infra._
2. **Phase 2 — Hash tier:** catalog hashing job + Tier 1 matching + agreement auto-accept.
   Gemini spend drops here.
3. **Phase 3 — Video mode:** detection loop, gating, burst+vote, dedup, session UX.
4. **Phase 4 — Snap & Sell:** flat-lay detection, confirm screen, pricing waterfall,
   Playwright render template, share sheet.
5. **Phase 5 — Multi-game:** CatalogProvider refactor, Riftbound catalog completeness,
   then Scryfall/MTG, then YGOPRODeck.

## 10. Validation Metrics (log from day one)

- % scans resolved per tier (target: ≥80% at Tier 1–2 on clean input)
- Auto-accept precision (corrections / auto-accepts — target ≥99%)
- Gemini calls per 100 scans (should trend down after Phase 2)
- Median scan-to-beep latency in video mode (target < 1.5s perceived)
- Snap & Sell: posts rendered per active vendor per week (viral loop health)

## 11. Explicit Non-Goals (v1)

- No Carousell/Shopee price scraping
- No auto-posting to Facebook (render + share sheet only)
- No condition/grading detection
- No overlapping/fanned card detection in flat-lay mode
