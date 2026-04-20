# Card Database & Vision AI Scanning — Implementation Spec

## Summary

Replace the existing pokemontcg.io-based card sync and Tesseract.js OCR recognition system with:
1. A GitHub-repo-based card seeder (from `PokemonTCG/pokemon-tcg-data`)
2. A Vision AI scanning system with provider abstraction (Gemini 2.5 Flash, GPT-4o Mini, Claude Haiku 4.5)
3. Extended database schema (card_sets, expanded cards, new inventory, scan_logs)
4. New scan UI with Quick Scan (batch) and Single Scan modes

---

## 1. Database Schema

### 1.1 New `card_sets` table

```sql
CREATE TABLE IF NOT EXISTS card_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  series TEXT NOT NULL,
  printed_total INTEGER,
  total INTEGER,
  ptcgo_code TEXT,
  release_date DATE,
  image_symbol TEXT,
  image_logo TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE card_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Card sets are publicly readable" ON card_sets FOR SELECT USING (true);
CREATE INDEX idx_sets_release ON card_sets (release_date DESC);
```

### 1.2 Expanded `cards` table (drop and recreate)

```sql
DROP TABLE IF EXISTS inventory CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS storefront_views CASCADE;
DROP TABLE IF EXISTS storefront_searches CASCADE;
DROP TABLE IF EXISTS cards CASCADE;

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  supertype TEXT NOT NULL,
  subtypes TEXT[],
  hp TEXT,
  types TEXT[],
  evolves_from TEXT,
  evolves_to TEXT[],
  set_id TEXT NOT NULL REFERENCES card_sets(id),
  set_name TEXT NOT NULL,
  set_series TEXT NOT NULL,
  number TEXT NOT NULL,
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

ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Cards are publicly readable" ON cards FOR SELECT USING (true);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_cards_name_trgm ON cards USING GIN (name gin_trgm_ops);
CREATE INDEX idx_cards_set_id ON cards (set_id);
CREATE INDEX idx_cards_rarity ON cards (rarity);
CREATE INDEX idx_cards_supertype ON cards (supertype);
CREATE INDEX idx_cards_name_set ON cards (name, set_id);
```

### 1.3 Search function

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

### 1.4 New `inventory` table (replaces existing)

```sql
CREATE TABLE IF NOT EXISTS inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  card_id TEXT REFERENCES cards(id),
  manual_card_name TEXT,
  manual_card_set TEXT,
  manual_card_number TEXT,
  condition TEXT NOT NULL DEFAULT 'NM' CHECK (condition IN ('NM', 'LP', 'MP', 'HP', 'DMG')),
  price_myr INTEGER,
  quantity INTEGER NOT NULL DEFAULT 1,
  photos TEXT[],
  is_graded BOOLEAN DEFAULT FALSE,
  grading_company TEXT,
  grade TEXT,
  subgrades JSONB,
  cert_number TEXT,
  deal_method TEXT DEFAULT 'BOTH' CHECK (deal_method IN ('COD', 'SHIPPING', 'BOTH')),
  cod_location TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SOLD', 'REMOVED', 'RESERVED')),
  scan_source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vendor manages own inventory" ON inventory FOR ALL USING (auth.uid() = vendor_id);
CREATE POLICY "Public can read active inventory" ON inventory FOR SELECT USING (status = 'ACTIVE');

CREATE INDEX idx_inventory_vendor ON inventory (vendor_id);
CREATE INDEX idx_inventory_card ON inventory (card_id);
CREATE INDEX idx_inventory_status ON inventory (status);
CREATE INDEX idx_inventory_vendor_active ON inventory (vendor_id) WHERE status = 'ACTIVE';
```

### 1.5 Recreate `transactions` table

```sql
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  card_id TEXT REFERENCES cards(id),
  type TEXT NOT NULL CHECK (type IN ('buy', 'sell')),
  quantity INTEGER NOT NULL DEFAULT 1,
  price_rm DECIMAL(10,2) NOT NULL,
  market_price_at_time DECIMAL(10,2),
  condition TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vendor manages own transactions" ON transactions FOR ALL USING (auth.uid() = vendor_id);
CREATE INDEX idx_transactions_vendor_id ON transactions (vendor_id);
CREATE INDEX idx_transactions_created_at ON transactions (created_at);
```

### 1.6 Recreate `storefront_views` and `storefront_searches`

```sql
CREATE TABLE IF NOT EXISTS storefront_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards(id),
  viewed_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE storefront_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can insert views" ON storefront_views FOR INSERT WITH CHECK (true);
CREATE POLICY "Vendor can read own views" ON storefront_views FOR SELECT USING (auth.uid() = vendor_id);

CREATE TABLE IF NOT EXISTS storefront_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  results_count INTEGER DEFAULT 0,
  searched_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE storefront_searches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can insert searches" ON storefront_searches FOR INSERT WITH CHECK (true);
CREATE POLICY "Vendor can read own searches" ON storefront_searches FOR SELECT USING (auth.uid() = vendor_id);
```

### 1.7 New `scan_logs` table

```sql
CREATE TABLE IF NOT EXISTS scan_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  scan_mode TEXT NOT NULL,
  vision_model TEXT NOT NULL,
  api_response JSONB,
  matched_card_id TEXT,
  vendor_corrected BOOLEAN DEFAULT FALSE,
  corrected_card_id TEXT,
  confidence TEXT,
  photo_quality_score FLOAT,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE scan_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vendor manages own scan logs" ON scan_logs FOR ALL USING (auth.uid() = vendor_id);
CREATE INDEX idx_scan_logs_vendor ON scan_logs (vendor_id);
CREATE INDEX idx_scan_logs_created ON scan_logs (created_at);
```

### 1.8 Migration strategy

Single migration file `00007_card_database_vision_scan.sql` that:
1. Creates `card_sets` table
2. Drops `storefront_views`, `storefront_searches`, `inventory`, `transactions`, `cards` (cascade)
3. Recreates `cards` with extended schema
4. Recreates `inventory` with new schema
5. Recreates `transactions`
6. Recreates `storefront_views` and `storefront_searches`
7. Creates `scan_logs`
8. Creates `search_cards` function
9. Sets up all RLS policies and indexes

This is destructive but acceptable since the app is pre-launch.

---

## 2. Seed Script

### 2.1 File: `scripts/seed-cards.ts`

Replaces `scripts/sync-cards.ts`.

### 2.2 Data source

Fetches JSON from GitHub raw URLs:
- Sets: `https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/sets/en.json`
- Cards per set: `https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/cards/en/{set_id}.json`

### 2.3 CLI interface

```bash
npx tsx scripts/seed-cards.ts              # full seed
npx tsx scripts/seed-cards.ts --set sv9    # single set
npx tsx scripts/seed-cards.ts --sets-only  # metadata only
npx tsx scripts/seed-cards.ts --local ./pokemon-tcg-data  # from local clone
```

### 2.4 Implementation

```
src/lib/seed/
  github-source.ts   -- fetches JSON from GitHub (or local path)
  seed-cards.ts      -- main seed logic: parse JSON → upsert to Supabase
  types.ts           -- types for the raw JSON structure
```

### 2.5 Behavior

1. Fetch `sets/en.json` → upsert all sets into `card_sets`
2. For each set (or specified `--set`), fetch `cards/en/{set_id}.json`
3. Map raw JSON fields to database columns
4. Upsert into `cards` table in batches of 500
5. Parallel fetching: 10 concurrent set file downloads
6. Progress logging throughout
7. Idempotent: safe to re-run (upsert on primary key)

---

## 3. Vision AI Abstraction Layer

### 3.1 File structure

```
src/lib/vision/
  types.ts          -- ScanResult, MatchResult, QualityResult
  provider.ts       -- VisionProvider interface + factory
  gemini.ts         -- Gemini 2.5 Flash implementation
  openai.ts         -- GPT-4o Mini implementation
  anthropic.ts      -- Claude Haiku 4.5 implementation
  quality.ts        -- client-side photo quality checks
  match.ts          -- card matching logic (DB waterfall)
  prompts.ts        -- shared prompt templates
```

### 3.2 Provider interface

```typescript
export interface VisionProvider {
  name: string;
  identify(imageBase64: string): Promise<ScanResult>;
}

export interface ScanResult {
  card_name: string | null;
  set_name: string | null;
  card_number: string | null;
  hp: string | null;
  rarity: string | null;
  card_type: string | null;
  subtypes: string[] | null;
  regulation_mark: string | null;
  confidence: "high" | "medium" | "low";
  is_graded: boolean;
  grading_company: string | null;
  grade: string | null;
  subgrades: Record<string, string> | null;
  cert_number: string | null;
}

export interface MatchResult {
  match: Card | null;
  candidates?: Card[];
  confidence: "exact" | "high" | "medium" | "low" | "none";
}
```

### 3.3 Provider selection

Environment variable `VISION_PROVIDER` selects the active provider:
```
VISION_PROVIDER=gemini      # default
GEMINI_API_KEY=...
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
```

Factory function in `provider.ts` instantiates the correct provider.

### 3.4 Prompt design

Single card prompt (from cardScan.md spec) stored in `prompts.ts`. Each provider implementation formats the prompt per its SDK requirements but uses the same text.

### 3.5 Batch handling

The API route handles batching:
- Receives up to 10 images per request
- Fires all identify calls concurrently (Promise.allSettled)
- Returns results array in same order as input

---

## 4. API Route

### 4.1 `POST /api/scan/identify`

**Request:**
```json
{
  "images": ["base64_1", "base64_2", ...],
  "mode": "quick_scan" | "single_scan"
}
```
Max 10 images per request.

**Response:**
```json
{
  "results": [
    {
      "scan": { ...ScanResult },
      "match": { ...MatchResult },
      "latency_ms": 1450
    }
  ]
}
```

**Behavior:**
1. Authenticate vendor (require session)
2. For each image: call Vision AI provider → get ScanResult
3. For each ScanResult: run matching logic against `cards` table
4. Log each scan to `scan_logs`
5. Return combined results

---

## 5. Scan Page UI

### 5.1 Route: `app/(vendor)/scan/page.tsx` (full rewrite)

### 5.2 Mode toggle

Tab bar at top: "Single" | "Quick Scan"

### 5.3 Single Scan Mode

1. Camera view (full width, top portion)
2. Shutter button
3. On capture: client-side quality check → if pass, send to API
4. Result card: matched card image + name + set + confidence
5. Confirmation form: condition, price (optional), quantity, grading (optional)
6. "Add to Inventory" button

### 5.4 Quick Scan Mode

1. Camera view with shutter button
2. Horizontal thumbnail strip at bottom with counter badge
3. Quality check per photo — rejects with toast, doesn't add to strip
4. "Identify All" button (appears when photos > 0)
5. Loading/progress screen
6. Results list:
   - Each row: thumbnail | card name + set | confidence badge
   - High confidence rows: green checkmark, pre-selected
   - Low confidence / unmatched: yellow warning, "Tap to search"
   - Tapping a row opens card search modal to correct
7. "Add All to Inventory" button → bulk insert

### 5.5 Client-side quality checks

Runs before adding to thumbnail strip (Quick Scan) or before API call (Single Scan):
- Average brightness: reject < 40 or > 240
- Laplacian variance (blur): reject < 50
- Minimum resolution: 480x480

---

## 6. Files/Directories to Delete

- `src/lib/sync/` (entire directory — `sync-cards.ts`, `pokemontcg.ts`)
- `src/lib/recognition/` (entire directory — `ocr.ts`, `parser.ts`)
- `scripts/sync-cards.ts`

---

## 7. Files to Modify

- `src/types/database.ts` — full update for new schema
- `src/hooks/use-card-search.ts` — use `search_cards` RPC function
- `src/hooks/use-inventory.ts` — new inventory schema (price in sen, nullable, new fields)
- `src/components/add-card-modal.tsx` — new inventory fields
- `src/components/sell-modal.tsx` — price in sen
- `src/components/grading-selector.tsx` — add subgrades, cert_number support
- `src/app/(vendor)/scan/page.tsx` — full rewrite
- `src/app/(vendor)/inventory/` — update for new schema
- `src/app/v/[slug]/` — update storefront for new inventory
- `package.json` — add/remove dependencies and scripts

---

## 8. New Dependencies

**Add:**
- `@google/generative-ai` (Gemini SDK)
- `openai` (OpenAI SDK)
- `@anthropic-ai/sdk` (Anthropic SDK)

**Remove:**
- `tesseract.js`

---

## 9. Environment Variables

New variables needed in `.env.local`:
```
VISION_PROVIDER=gemini
GEMINI_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
```
