# KadVault — Card Database & Card Scanning Specification

## Table of Contents

1. [Card Database](#1-card-database)
2. [Card Scanning](#2-card-scanning)
3. [Integration: Scan → Database → Inventory](#3-integration-scan--database--inventory)

---

## 1. Card Database

### 1.1 Overview

KadVault maintains a self-hosted Pokémon TCG card catalog in Supabase, seeded from the open-source `PokemonTCG/pokemon-tcg-data` GitHub repository. There is no live API dependency in production — all card data lives in the database. No external pricing data is stored; vendors set their own MYR prices through listings.

### 1.2 Data Source

| Item             | Detail                                                                 |
| ---------------- | ---------------------------------------------------------------------- |
| Repository       | `https://github.com/PokemonTCG/pokemon-tcg-data`                       |
| License          | Community-maintained, open data                                        |
| Total cards      | ~18,500+ (English)                                                     |
| Total sets       | ~126+                                                                  |
| Update frequency | Community updates within days of new set releases                      |
| Data format      | JSON files — `sets/en.json` for sets, `cards/en/{set_id}.json` per set |
| Image CDN        | `images.pokemontcg.io` (reliable, free, hi-res PNGs)                   |

### 1.3 What We Store

**From the source data (card identity):**

- Card ID (e.g., `sv9-25`)
- Name (e.g., `Pikachu ex`)
- Supertype (`Pokémon`, `Trainer`, `Energy`)
- Subtypes (e.g., `["ex", "Tera"]`, `["Supporter"]`, `["Item"]`)
- HP
- Types (e.g., `["Fire"]`, `["Water", "Dark"]`)
- Evolves from / Evolves to
- Set ID, Set Name, Series
- Card number (e.g., `25/159`)
- Rarity (e.g., `Double Rare`, `Illustration Rare`, `Special Art Rare`)
- Artist
- Attacks (as JSONB)
- Abilities (as JSONB)
- Weaknesses / Resistances (as JSONB)
- Retreat cost
- Flavor text
- Rules (rule box text)
- Images (small + large URLs)
- National Pokédex numbers
- Legalities (Standard, Expanded, Unlimited)
- Regulation mark

**What we explicitly DO NOT store:**

- TCGplayer prices (USD, stale, irrelevant for MY market)
- Cardmarket prices (EUR, sometimes missing)
- Any external pricing data

### 1.4 Database Schema

```sql
-- Sets table
CREATE TABLE IF NOT EXISTS card_sets (
  id TEXT PRIMARY KEY,                    -- e.g., "sv9", "base1", "me2pt5"
  name TEXT NOT NULL,                     -- e.g., "Journey Together"
  series TEXT NOT NULL,                   -- e.g., "Scarlet & Violet"
  printed_total INTEGER,                  -- cards shown on card (e.g., 159)
  total INTEGER,                          -- total including secrets (e.g., 190)
  ptcgo_code TEXT,                        -- e.g., "JTG"
  release_date DATE,
  image_symbol TEXT,                      -- set symbol URL
  image_logo TEXT,                        -- set logo URL
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cards table
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,                    -- e.g., "sv9-25"
  name TEXT NOT NULL,                     -- e.g., "Pikachu ex"
  supertype TEXT NOT NULL,                -- "Pokémon", "Trainer", "Energy"
  subtypes TEXT[],
  hp TEXT,
  types TEXT[],
  evolves_from TEXT,
  evolves_to TEXT[],
  set_id TEXT NOT NULL REFERENCES card_sets(id),
  set_name TEXT NOT NULL,                 -- denormalized
  set_series TEXT NOT NULL,               -- denormalized
  number TEXT NOT NULL,                   -- e.g., "25" or "GG56/GG70"
  rarity TEXT,
  artist TEXT,
  attacks JSONB,
  weaknesses JSONB,
  resistances JSONB,
  retreat_cost TEXT[],
  converted_retreat_cost INTEGER,
  rules TEXT[],
  abilities JSONB,
  flavor_text TEXT,
  image_small TEXT,
  image_large TEXT,
  national_pokedex_numbers INTEGER[],
  legality_standard TEXT,
  legality_expanded TEXT,
  legality_unlimited TEXT,
  regulation_mark TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 1.5 Indexes

```sql
-- Fuzzy search on card name (requires pg_trgm extension)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_cards_name_trgm ON cards USING GIN (name gin_trgm_ops);

-- Common query patterns
CREATE INDEX idx_cards_set_id ON cards (set_id);
CREATE INDEX idx_cards_rarity ON cards (rarity);
CREATE INDEX idx_cards_supertype ON cards (supertype);
CREATE INDEX idx_cards_name_set ON cards (name, set_id);
CREATE INDEX idx_sets_release ON card_sets (release_date DESC);
```

### 1.6 Search Function

```sql
CREATE OR REPLACE FUNCTION search_cards(
  search_query TEXT,
  result_limit INTEGER DEFAULT 20,
  result_offset INTEGER DEFAULT 0
)
RETURNS SETOF cards
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM cards
  WHERE
    name ILIKE '%' || search_query || '%'
    OR set_name ILIKE '%' || search_query || '%'
    OR number ILIKE '%' || search_query || '%'
  ORDER BY
    CASE WHEN name ILIKE search_query THEN 0
         WHEN name ILIKE search_query || '%' THEN 1
         WHEN number = search_query THEN 2
         ELSE 3
    END,
    set_id DESC,
    name ASC
  LIMIT result_limit
  OFFSET result_offset;
$$;
```

### 1.7 Row Level Security

```sql
ALTER TABLE card_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;

-- Cards are public read, no client write (seed script uses service key)
CREATE POLICY "Cards are publicly readable" ON cards FOR SELECT USING (true);
CREATE POLICY "Card sets are publicly readable" ON card_sets FOR SELECT USING (true);
```

### 1.8 Seeding Process

**Initial seed:**

```bash
git clone https://github.com/PokemonTCG/pokemon-tcg-data.git
npm install @supabase/supabase-js
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_KEY="your-service-role-key"
node seed.js
```

**Updating when new sets release (~every 3 months):**

```bash
cd pokemon-tcg-data && git pull origin master && cd ..
node seed.js
```

The seed script uses upsert (ON CONFLICT on `id`), so re-running is safe — updates existing cards and adds new ones without duplicates. Supports `--set sv9` for single-set seeding and `--sets-only` for metadata-only updates.

**Handling cards not yet in the repo:**

If a vendor flags "card not found" (e.g., a set just released and the repo hasn't updated yet), KadVault supports manual card entry:

1. Vendor taps "Card not found? Add manually"
2. Enters: card name, set name, card number, rarity, condition
3. Uploads a photo (serves as the card image until the repo catches up)
4. Card is added to a `manual_cards` table with `status: pending_review`
5. Admin merges into the main `cards` table after verification
6. When the repo updates and the card appears, the manual entry is linked to the canonical card ID

### 1.9 MYR Price Data Strategy

No external pricing API is used. Malaysian market prices are built organically from vendor listings:

- When multiple vendors list the same card, KadVault can compute: average listing price, lowest price, highest price, price trend (7/30/90 day)
- This data is proprietary — nobody else has aggregated MYR Pokémon TCG pricing
- Displayed to vendors as "Market Price: ~RM85" on card pages once sufficient data exists (minimum 3 vendors listing the same card)
- Powers the Market Signals feature (see separate spec)

---

## 2. Card Scanning

### 2.1 Overview

KadVault offers a rapid-fire photo scanning feature that lets vendors photograph cards one at a time in quick succession, then batch-identifies all cards via a vision AI API. This replaces manual search-and-add, reducing inventory entry time from 30+ minutes per 100 cards to under 3 minutes.

### 2.2 Vision AI Model Selection

**Shortlisted models (all via API, no self-hosting):**

| Model             | Provider  | Input $/M tokens | Output $/M tokens | Cost per scan (MYR) | Strengths                                        |
| ----------------- | --------- | ---------------- | ----------------- | ------------------- | ------------------------------------------------ |
| Gemini 2.5 Flash  | Google    | $0.30            | $3.00             | ~RM0.003            | Best price-to-quality, free tier for prototyping |
| GPT-4o Mini       | OpenAI    | $0.15            | $0.60             | ~RM0.001            | Battle-tested, reliable structured JSON output   |
| Claude Haiku 4.5  | Anthropic | $0.80            | $4.00             | ~RM0.008            | Highest accuracy, excellent structured output    |
| Gemini Flash-Lite | Google    | $0.10            | $0.40             | ~RM0.001            | Cheapest, suitable for simple single-card scans  |

**Estimated monthly costs at various volumes:**

| Scans/month | Gemini 2.5 Flash | GPT-4o Mini | Claude Haiku 4.5 | Gemini Flash-Lite |
| ----------- | ---------------- | ----------- | ---------------- | ----------------- |
| 500         | RM1.50           | RM0.65      | RM4.00           | RM0.50            |
| 1,000       | RM3.00           | RM1.30      | RM8.00           | RM1.00            |
| 5,000       | RM15.00          | RM6.50      | RM40.00          | RM5.00            |
| 10,000      | RM30.00          | RM13.00     | RM80.00          | RM10.00           |

**Eliminated options:**

- **Tesseract.js (OCR)** — Too unreliable for TCG cards. Tiny text, holographic surfaces, varied lighting cause frequent misreads.
- **Qwen2.5-VL (self-hosted)** — Self-hosting cost doesn't make sense at KadVault's scale. GPU VPS ~RM100+/month vs RM3/month API costs. CPU-only is too slow (5-10 sec/scan).
- **Claude Haiku 4.5** — More expensive than budget options but highest accuracy for structured card identification. Worth benchmarking as the "quality tier" model.
- **Scrydex Image Analysis** — $29+/month minimum, credit-based, unnecessary when general vision models work well for card identification.

**Recommendation:** Benchmark Gemini 2.5 Flash and GPT-4o Mini with 50 real card photos before committing. Use the winner as the primary model. Consider using a cheaper model (Flash-Lite) for single clear scans and a stronger model (Gemini 2.5 Flash) for binder/multi-card scenarios.

### 2.3 Scan Modes

#### Mode 1: Quick Scan (Rapid-Fire Photo Batch) — PRIMARY

The main scanning mode. Vendor photographs cards one at a time in rapid succession.

**User flow:**

1. Vendor taps **"Quick Scan"** → camera opens in photo mode
2. Places first card in front of camera → **taps shutter button**
3. Thumbnail appears in a horizontal strip at the bottom → counter shows "1"
4. Swaps to next card → tap → "2"
5. Repeats as fast as they want (realistic pace: 1 card per 1-2 seconds)
6. When done, taps **"Identify All"**
7. Loading screen: "Identifying 23 cards..." with a progress bar
8. **Results screen** shows a scrollable list:
   - Photo thumbnail | Matched card name + set + number | Confidence indicator
   - Cards matched with high confidence are pre-checked ✅
   - Low confidence or unmatched cards are flagged ⚠️ for manual review
9. Vendor taps any incorrect match → opens card search to correct
10. Taps **"Add All to Inventory"** → bulk added with default condition (NM), no price
11. Vendor can edit condition and price later from the inventory screen

**Technical implementation:**

```
Camera capture (browser MediaDevices API)
    ↓
Photos stored temporarily in browser memory (base64)
    ↓
On "Identify All" → fire API calls in parallel batches
    ↓
Each API call returns: { card_name, set_name, card_number, confidence }
    ↓
Match API response against local Supabase cards table
    ↓
Return matched card_id or flag as unmatched
    ↓
Display results for vendor confirmation
    ↓
Confirmed cards → INSERT into inventory table
```

**API call parallelism:**

- Fire in batches of 10 concurrent requests to avoid rate limits
- Each call takes ~1-2 seconds
- 100 cards = 10 batches = ~15-20 seconds total processing
- Show progress bar updating in real-time

**Performance targets:**

| Metric                                | Target         |
| ------------------------------------- | -------------- |
| Photo capture to thumbnail            | < 200ms        |
| Total identification time (100 cards) | < 30 seconds   |
| Single card match accuracy            | > 90%          |
| Binder page (3x3) accuracy            | > 75% per card |

#### Mode 2: Single Card Scan — SECONDARY

For adding one card at a time or verifying a specific card.

**User flow:**

1. Vendor taps **"Scan Card"** from the inventory add screen
2. Camera opens → vendor photographs the card
3. API call fires immediately (single request)
4. Result appears in 1-2 seconds: matched card with image preview
5. Vendor confirms → card pre-fills in the add-to-inventory form
6. Vendor adds condition, price, quantity → saves

This mode is also used as the **fallback** when Quick Scan can't identify a card — vendor taps the flagged card, takes a better photo, and re-scans.

#### Mode 3: Binder Page Scan — FUTURE / EXPERIMENTAL

Scan a full 3x3 or 2x2 binder page in one photo.

**Challenges:**

- Each card is smaller in frame → less text resolution
- Sleeve glare, especially on holographic cards
- Edge cards may be partially cut off
- Model must understand grid layout and return ordered results

**Approach if implemented:**

- Use Gemini 2.5 Flash (strongest spatial reasoning at budget tier)
- Prompt specifies grid layout: "This is a 3x3 binder page. Identify each card by position (top-left to bottom-right). Return as JSON array of 9 objects."
- Always require vendor confirmation — accuracy will be lower than single scans
- Consider as a Phase 2 feature after Quick Scan is validated

### 2.4 Vision API Prompt Design

#### Single Card Prompt

```
You are a Pokémon TCG card identification system. Analyze this card image and return ONLY a JSON object with these fields:

{
  "card_name": "exact card name as printed",
  "set_name": "expansion set name",
  "card_number": "card number as printed (e.g., '125/197' or 'GG56/GG70')",
  "hp": "HP value if visible",
  "rarity": "rarity if identifiable",
  "card_type": "Pokémon, Trainer, or Energy",
  "subtypes": ["ex", "VSTAR", "Supporter", etc.],
  "regulation_mark": "letter if visible (e.g., 'F', 'G', 'H')",
  "confidence": "high, medium, or low"
}

If you cannot identify a field, set it to null. Return ONLY the JSON, no other text.
```

#### Batch / Binder Page Prompt

```
You are a Pokémon TCG card identification system. This image shows multiple cards in a binder page. Identify each card by its position in the grid (left-to-right, top-to-bottom).

Return ONLY a JSON array where each object has:

{
  "position": "row-column (e.g., '1-1' for top-left)",
  "card_name": "exact card name",
  "set_name": "expansion set name",
  "card_number": "card number if readable",
  "confidence": "high, medium, or low"
}

If a pocket is empty, include it with card_name: null. Return ONLY the JSON array, no other text.
```

### 2.5 Matching API Response to Database

After the vision API returns card details, match against the local `cards` table:

**Matching priority (waterfall):**

1. **Exact match on card number + set:** If the API returns `card_number: "GG56/GG70"`, query `WHERE number = 'GG56/GG70'`. This is the most reliable match.
2. **Name + set fuzzy match:** If card number isn't readable, search `WHERE name ILIKE '%Hisuian Zoroark VSTAR%' AND set_name ILIKE '%Crown Zenith%'`.
3. **Name-only fuzzy match:** If set isn't identifiable, search by name and return multiple candidates for vendor to choose from.
4. **No match:** Flag as unidentified, prompt vendor to manually search or add.

```typescript
async function matchCard(apiResult: ScanResult): Promise<MatchResult> {
  // Priority 1: Exact card number match
  if (apiResult.card_number) {
    const exact = await supabase
      .from("cards")
      .select("*")
      .ilike("number", apiResult.card_number)
      .limit(5);

    if (exact.data?.length === 1) {
      return { match: exact.data[0], confidence: "exact" };
    }
  }

  // Priority 2: Name + set
  if (apiResult.card_name && apiResult.set_name) {
    const nameSet = await supabase
      .from("cards")
      .select("*")
      .ilike("name", `%${apiResult.card_name}%`)
      .ilike("set_name", `%${apiResult.set_name}%`)
      .limit(10);

    if (nameSet.data?.length === 1) {
      return { match: nameSet.data[0], confidence: "high" };
    }
    if (nameSet.data?.length > 1) {
      return { candidates: nameSet.data, confidence: "medium" };
    }
  }

  // Priority 3: Name only
  if (apiResult.card_name) {
    const nameOnly = await supabase
      .from("cards")
      .select("*")
      .ilike("name", `%${apiResult.card_name}%`)
      .order("set_id", { ascending: false })
      .limit(10);

    if (nameOnly.data?.length > 0) {
      return { candidates: nameOnly.data, confidence: "low" };
    }
  }

  // Priority 4: No match
  return { match: null, confidence: "none" };
}
```

### 2.6 Graded Card (Slab) Scanning

When scanning a graded card, the vision API should also extract grading information.

**Additional fields in prompt for slabs:**

```json
{
  "is_graded": true,
  "grading_company": "PSA | BGS | CGC | SGC | TAG | ACE",
  "grade": "10",
  "subgrades": {
    "centering": "9.5",
    "corners": "10",
    "edges": "9.5",
    "surface": "10"
  },
  "cert_number": "12345678"
}
```

**Supported grading companies:**

| Company       | Label Color | Scale              | Top Grade        | Has Sub-grades                           |
| ------------- | ----------- | ------------------ | ---------------- | ---------------------------------------- |
| PSA           | Red         | 1-10 (with 1.5)    | Gem Mint 10      | No                                       |
| BGS (Beckett) | Blue        | 1-10 (half-points) | Black Label 10   | Yes (Centering, Corners, Edges, Surface) |
| CGC           | Purple      | 1-10 (half-points) | Pristine 10      | Optional                                 |
| SGC           | Gold        | 1-10               | Pristine Gold 10 | No                                       |
| TAG           | Cyan        | 1-10               | Pristine 10      | No                                       |
| ACE           | Green       | 1-10               | 10               | No                                       |

The cert number extracted from the slab label allows buyers to verify authenticity on the grading company's website.

### 2.7 Error Handling

| Scenario                         | Handling                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| API returns 429 (rate limit)     | Retry with exponential backoff, reduce parallel batch size                          |
| API returns 500                  | Retry once, then skip and flag for manual entry                                     |
| API returns low confidence       | Show result with ⚠️ warning, prompt vendor to verify                                |
| API returns card not in database | Offer "Card not found? Search manually" or "Add new card"                           |
| Photo is blurry / too dark       | Client-side quality check before sending (blur detection via canvas pixel analysis) |
| API timeout (>10 seconds)        | Cancel and flag for re-scan                                                         |
| Multiple candidates returned     | Show card images side-by-side for vendor to pick the correct one                    |

### 2.8 Client-Side Photo Quality Checks

Before sending a photo to the API, run lightweight checks on the client:

```typescript
function checkPhotoQuality(imageData: ImageData): QualityResult {
  // 1. Brightness check — reject too dark or too bright
  const avgBrightness = calculateAverageBrightness(imageData);
  if (avgBrightness < 40)
    return { ok: false, reason: "Too dark. Add more light." };
  if (avgBrightness > 240)
    return { ok: false, reason: "Too bright. Reduce glare." };

  // 2. Blur detection — Laplacian variance
  const blurScore = calculateLaplacianVariance(imageData);
  if (blurScore < 50)
    return { ok: false, reason: "Image is blurry. Hold steady." };

  // 3. Minimum resolution
  if (imageData.width < 480 || imageData.height < 480) {
    return { ok: false, reason: "Image too small. Move closer." };
  }

  return { ok: true };
}
```

This prevents wasting API calls on photos that will fail identification.

---

## 3. Integration: Scan → Database → Inventory

### 3.1 Complete Flow

```
┌─────────────────────────────────────────────────┐
│                 VENDOR SCANS CARDS               │
│                                                  │
│  Quick Scan Mode:                                │
│  [Photo] [Photo] [Photo] ... [Identify All]      │
│                                                  │
│  Single Scan Mode:                               │
│  [Photo] → instant identification                │
└───────────────┬─────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────┐
│              VISION API (Gemini / GPT)           │
│                                                  │
│  Input: card photo (base64)                      │
│  Output: { card_name, set_name, card_number,     │
│            confidence, grading_info }             │
│                                                  │
│  Cost: ~RM0.001-0.003 per scan                   │
└───────────────┬─────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────┐
│           DATABASE MATCHING (Supabase)           │
│                                                  │
│  1. Exact match on card_number                   │
│  2. Fuzzy match on name + set                    │
│  3. Name-only search with candidates             │
│  4. No match → manual entry                      │
│                                                  │
│  Result: matched card_id or candidate list       │
└───────────────┬─────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────┐
│          VENDOR CONFIRMATION SCREEN              │
│                                                  │
│  ✅ Pikachu ex — Journey Together — 25/159       │
│  ✅ Charizard ex — Obsidian Flames — 125/197     │
│  ⚠️ Unknown card — [Tap to search manually]      │
│  ✅ Hisuian Zoroark VSTAR — Crown Zenith — GG56  │
│                                                  │
│  [Add All to Inventory]                          │
└───────────────┬─────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────┐
│          INVENTORY TABLE (Supabase)              │
│                                                  │
│  INSERT INTO inventory (                         │
│    vendor_id, card_id, condition, price_myr,     │
│    quantity, photos, is_graded, grading_company, │
│    grade, subgrades, cert_number, status         │
│  )                                               │
│                                                  │
│  Defaults: condition=NM, price=null,             │
│  quantity=1, status=ACTIVE                       │
│  Vendor edits price/condition later              │
└─────────────────────────────────────────────────┘
```

### 3.2 Inventory Table Schema

```sql
CREATE TABLE IF NOT EXISTS inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  card_id TEXT REFERENCES cards(id),          -- null if manual entry
  manual_card_name TEXT,                       -- fallback if not in card DB
  manual_card_set TEXT,
  manual_card_number TEXT,
  condition TEXT NOT NULL DEFAULT 'NM',        -- NM, LP, MP, HP, DMG
  price_myr INTEGER,                           -- in sen (null = not priced yet)
  quantity INTEGER NOT NULL DEFAULT 1,
  photos TEXT[],                                -- vendor's own card photos
  is_graded BOOLEAN DEFAULT FALSE,
  grading_company TEXT,                        -- psa, bgs, cgc, sgc, tag, ace
  grade TEXT,                                  -- e.g., "10", "9.5"
  subgrades JSONB,                             -- {"centering":"9.5","corners":"10",...}
  cert_number TEXT,
  deal_method TEXT DEFAULT 'BOTH',             -- COD, SHIPPING, BOTH
  cod_location TEXT,                           -- e.g., "SS2 PJ", "Bukit Bintang"
  status TEXT NOT NULL DEFAULT 'ACTIVE',       -- ACTIVE, SOLD, REMOVED, RESERVED
  scan_source TEXT,                            -- 'quick_scan', 'single_scan', 'manual'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_inventory_vendor ON inventory (vendor_id);
CREATE INDEX idx_inventory_card ON inventory (card_id);
CREATE INDEX idx_inventory_status ON inventory (status);
CREATE INDEX idx_inventory_vendor_active ON inventory (vendor_id) WHERE status = 'ACTIVE';
```

### 3.3 Scan Analytics (for optimizing accuracy over time)

Track scan results to measure and improve accuracy:

```sql
CREATE TABLE IF NOT EXISTS scan_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  scan_mode TEXT NOT NULL,                     -- 'quick_scan', 'single_scan'
  vision_model TEXT NOT NULL,                  -- 'gemini-2.5-flash', 'gpt-4o-mini'
  api_response JSONB,                          -- raw API response
  matched_card_id TEXT,                        -- what it matched to
  vendor_corrected BOOLEAN DEFAULT FALSE,      -- did vendor change the match?
  corrected_card_id TEXT,                      -- what vendor corrected to
  confidence TEXT,                             -- high, medium, low, none
  photo_quality_score FLOAT,                   -- brightness/blur metrics
  latency_ms INTEGER,                          -- API response time
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

This data enables:

- Accuracy tracking: what % of scans are corrected by vendors?
- Model comparison: if testing multiple models, which performs better?
- Problem card identification: which cards are frequently misidentified?
- Quality threshold tuning: what blur/brightness scores correlate with failed scans?

---

## Appendix A: Example API Response (Single Card)

**Input:** Photo of Hisuian Zoroark VSTAR (GG56/GG70)

**Vision API returns:**

```json
{
  "card_name": "Hisuian Zoroark VSTAR",
  "set_name": "Crown Zenith",
  "card_number": "GG56/GG70",
  "hp": "270",
  "rarity": "Secret Rare",
  "card_type": "Pokémon",
  "subtypes": ["VSTAR"],
  "regulation_mark": "F",
  "confidence": "high"
}
```

**Database match query:**

```sql
SELECT * FROM cards WHERE number ILIKE '%GG56/GG70%';
-- Returns exactly 1 row → exact match
```

**Result:** Card auto-fills in inventory with `card_id`, all details pre-populated.

## Appendix B: Example API Response (2x2 Binder)

**Input:** Photo of 2x2 binder page with Trainer cards

**Vision API returns:**

```json
[
  {
    "position": "1-1",
    "card_name": "Raihan",
    "set_name": "Evolving Skies",
    "card_number": null,
    "confidence": "high"
  },
  {
    "position": "1-2",
    "card_name": "Bea",
    "set_name": "Vivid Voltage",
    "card_number": null,
    "confidence": "high"
  },
  {
    "position": "2-1",
    "card_name": "Allister",
    "set_name": "Evolving Skies",
    "card_number": null,
    "confidence": "medium"
  },
  {
    "position": "2-2",
    "card_name": "Piers",
    "set_name": "Champion's Path",
    "card_number": null,
    "confidence": "medium"
  }
]
```

**Note:** Card numbers are null because they're unreadable at binder-page resolution. Matching falls to Priority 2 (name + set fuzzy match), which may return multiple candidates for vendor selection.

## Appendix C: Card Condition Definitions

| Code | Condition         | Description                                                                    |
| ---- | ----------------- | ------------------------------------------------------------------------------ |
| NM   | Near Mint         | Card appears unplayed. No visible scratches, whitening, or edge wear.          |
| LP   | Lightly Played    | Minor edge wear or light scratching. Card has been sleeved and played.         |
| MP   | Moderately Played | Noticeable wear, light creasing, or surface scratching. Card is fully legible. |
| HP   | Heavily Played    | Significant wear, creases, or staining. Card is still structurally intact.     |
| DMG  | Damaged           | Major damage: tears, water damage, heavy bending. May not be tournament-legal. |

For graded cards, the grade from the grading company supersedes the condition code. A graded card's condition is expressed by its grade (e.g., PSA 10, BGS 9.5) rather than NM/LP/etc.
