-- Migration 00007: Extended card database + vision scan support
-- Drops and recreates cards, inventory, transactions, storefront_views,
-- storefront_searches, and scan_logs with enriched schemas.
-- vendors, events, event_vendors, and event_flags are NOT touched.

-- ============================================
-- STEP 1: DROP DEPENDENT TABLES (order matters — children first)
-- ============================================
DROP TABLE IF EXISTS storefront_views CASCADE;
DROP TABLE IF EXISTS storefront_searches CASCADE;
DROP TABLE IF EXISTS scan_logs CASCADE;
DROP TABLE IF EXISTS inventory CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS cards CASCADE;
DROP TABLE IF EXISTS card_sets CASCADE;

-- ============================================
-- STEP 2: CARD SETS (new reference table)
-- ============================================
CREATE TABLE card_sets (
  id            TEXT PRIMARY KEY,            -- e.g. "sv1", "base1"
  name          TEXT NOT NULL,               -- e.g. "Scarlet & Violet"
  series        TEXT,                        -- e.g. "Scarlet & Violet"
  printed_total INTEGER,
  total         INTEGER,
  ptcgo_code    TEXT,                        -- in-game export code
  release_date  DATE,
  image_symbol  TEXT,                        -- URL to set symbol image
  image_logo    TEXT,                        -- URL to set logo image
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_card_sets_release_date ON card_sets (release_date DESC);

ALTER TABLE card_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read card_sets"
  ON card_sets FOR SELECT
  USING (true);

-- ============================================
-- STEP 3: CARDS (extended schema)
-- ============================================

-- Ensure pg_trgm is available (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE cards (
  id                          TEXT PRIMARY KEY,          -- e.g. "sv1-25"
  name                        TEXT NOT NULL,
  supertype                   TEXT,                      -- Pokémon | Trainer | Energy
  subtypes                    TEXT[],
  hp                          TEXT,                      -- stored as text to preserve "None" / blanks
  types                       TEXT[],
  evolves_from                TEXT,
  evolves_to                  TEXT[],
  -- Set reference
  set_id                      TEXT REFERENCES card_sets(id),
  set_name                    TEXT NOT NULL DEFAULT '',
  set_series                  TEXT,
  number                      TEXT,                      -- printed card number, e.g. "025/198"
  rarity                      TEXT,
  artist                      TEXT,
  -- Game mechanics (JSON for flexibility)
  attacks                     JSONB,
  weaknesses                  JSONB,
  resistances                 JSONB,
  retreat_cost                TEXT[],
  converted_retreat_cost      INTEGER,
  rules                       TEXT[],
  abilities                   JSONB,
  flavor_text                 TEXT,
  -- Images
  image_small                 TEXT,
  image_large                 TEXT,
  -- Pokédex
  national_pokedex_numbers    INTEGER[],
  -- Legality
  legality_standard           TEXT,
  legality_expanded           TEXT,
  legality_unlimited          TEXT,
  regulation_mark             TEXT,
  -- Timestamps
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- Trigram index for fuzzy name search (autocomplete)
CREATE INDEX idx_cards_name_trgm       ON cards USING gin (name gin_trgm_ops);
-- Set-based filtering
CREATE INDEX idx_cards_set_id          ON cards (set_id);
-- Rarity filtering
CREATE INDEX idx_cards_rarity          ON cards (rarity);
-- Supertype filtering
CREATE INDEX idx_cards_supertype       ON cards (supertype);
-- Compound: name + set for precise match
CREATE INDEX idx_cards_name_set_id     ON cards (name, set_id);
-- Card number lookups (OCR / cross-event search)
CREATE INDEX idx_cards_number          ON cards (number);

-- RLS for cards — public read-only
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read cards"
  ON cards FOR SELECT
  USING (true);

-- ============================================
-- STEP 4: search_cards FUNCTION (updated for new schema)
-- ============================================
-- Drops old version if it exists (different signature)
DROP FUNCTION IF EXISTS search_cards(TEXT, INTEGER);
DROP FUNCTION IF EXISTS search_cards(TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION search_cards(
  search_query  TEXT,
  result_limit  INT DEFAULT 20,
  result_offset INT DEFAULT 0
)
RETURNS SETOF cards
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM cards
  WHERE
    name     ILIKE '%' || search_query || '%'
    OR set_name ILIKE '%' || search_query || '%'
    OR number   ILIKE '%' || search_query || '%'
  ORDER BY
    -- Exact prefix match on name is highest priority
    CASE WHEN name ILIKE search_query || '%' THEN 0 ELSE 1 END,
    -- Exact number match next
    CASE WHEN number ILIKE search_query        THEN 0 ELSE 1 END,
    -- Then trigram similarity on name
    similarity(name, search_query) DESC,
    name ASC
  LIMIT result_limit
  OFFSET result_offset;
$$;

GRANT EXECUTE ON FUNCTION search_cards(TEXT, INT, INT) TO anon, authenticated;

-- ============================================
-- STEP 5: INVENTORY (extended schema)
-- ============================================
CREATE TABLE inventory (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id         UUID    NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,

  -- Card reference — nullable to support manual/unmatched entries
  card_id           TEXT    REFERENCES cards(id),
  manual_card_name  TEXT,   -- used when card_id is NULL
  manual_card_set   TEXT,
  manual_card_number TEXT,

  -- Condition
  condition         TEXT    NOT NULL DEFAULT 'NM'
                    CHECK (condition IN ('NM', 'LP', 'MP', 'HP', 'DMG')),

  -- Pricing — stored as integer cents (MYR × 100) to avoid float precision issues
  -- NULL means vendor hasn't set a price yet
  price_myr         INTEGER,

  quantity          INTEGER NOT NULL DEFAULT 1,

  -- Multiple condition photos (array of Storage URLs)
  photos            TEXT[]  NOT NULL DEFAULT '{}',

  -- Grading (PSA / BGS / CGC / ACE)
  is_graded         BOOLEAN NOT NULL DEFAULT false,
  grading_company   TEXT,
  grade             TEXT,
  subgrades         JSONB,
  cert_number       TEXT,

  -- Deal logistics
  deal_method       TEXT NOT NULL DEFAULT 'COD'
                    CHECK (deal_method IN ('COD', 'SHIPPING', 'BOTH')),
  cod_location      TEXT,

  -- Listing lifecycle
  status            TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'SOLD', 'REMOVED', 'RESERVED')),

  -- Scan provenance (how was this card identified?)
  scan_source       TEXT,   -- 'ocr' | 'search' | 'vision' | 'csv' | 'manual'

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for inventory queries
CREATE INDEX idx_inventory_vendor_id       ON inventory (vendor_id);
CREATE INDEX idx_inventory_card_id         ON inventory (card_id);
CREATE INDEX idx_inventory_vendor_status   ON inventory (vendor_id, status);
CREATE INDEX idx_inventory_vendor_updated  ON inventory (vendor_id, updated_at DESC);

-- RLS for inventory
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendor manages own inventory"
  ON inventory FOR ALL
  USING (auth.uid() = vendor_id);

CREATE POLICY "Public can read inventory"
  ON inventory FOR SELECT
  USING (true);

-- ============================================
-- STEP 6: TRANSACTIONS (recreated with nullable card_id)
-- ============================================
CREATE TABLE transactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id             UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  card_id               TEXT REFERENCES cards(id),      -- nullable for manual entries
  type                  TEXT NOT NULL CHECK (type IN ('buy', 'sell')),
  quantity              INTEGER NOT NULL DEFAULT 1,
  price_rm              DECIMAL(10,2) NOT NULL,
  market_price_at_time  DECIMAL(10,2),
  condition             TEXT NOT NULL,
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transactions_vendor_id   ON transactions (vendor_id);
CREATE INDEX idx_transactions_created_at  ON transactions (created_at);
CREATE INDEX idx_transactions_vendor_time ON transactions (vendor_id, created_at DESC);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendor manages own transactions"
  ON transactions FOR ALL
  USING (auth.uid() = vendor_id);

-- ============================================
-- STEP 7: STOREFRONT ANALYTICS (recreated)
-- ============================================
CREATE TABLE storefront_views (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id  UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  card_id    TEXT REFERENCES cards(id),       -- nullable: view may be on a manual entry
  viewed_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_storefront_views_vendor_card ON storefront_views (vendor_id, card_id);
CREATE INDEX idx_storefront_views_vendor_time ON storefront_views (vendor_id, viewed_at);

ALTER TABLE storefront_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert views"   ON storefront_views FOR INSERT WITH CHECK (true);
CREATE POLICY "Vendors read own views"    ON storefront_views FOR SELECT USING (auth.uid() = vendor_id);

CREATE TABLE storefront_searches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id      UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  query          TEXT NOT NULL,
  results_count  INTEGER NOT NULL DEFAULT 0,
  searched_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_storefront_searches_vendor_time ON storefront_searches (vendor_id, searched_at);

ALTER TABLE storefront_searches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert searches" ON storefront_searches FOR INSERT WITH CHECK (true);
CREATE POLICY "Vendors read own searches"  ON storefront_searches FOR SELECT USING (auth.uid() = vendor_id);

-- ============================================
-- STEP 8: SCAN LOGS (vision / OCR telemetry)
-- ============================================
CREATE TABLE scan_logs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id            UUID REFERENCES vendors(id) ON DELETE CASCADE,

  -- What type of scan was this?
  scan_mode            TEXT,    -- 'single' | 'binder' | 'csv'
  -- Which vision model was called (if any)?
  vision_model         TEXT,    -- e.g. 'claude-sonnet-4-6', 'tesseract-v5', null

  -- Full API response stored for debugging / retraining
  api_response         JSONB,

  -- Card identification result
  matched_card_id      TEXT REFERENCES cards(id),

  -- Did the vendor correct the auto-identified card?
  vendor_corrected     BOOLEAN NOT NULL DEFAULT false,
  corrected_card_id    TEXT REFERENCES cards(id),

  -- Model confidence (0.0–1.0, NULL if not available)
  confidence           FLOAT,

  -- Image quality heuristic computed client-side (0.0–1.0)
  photo_quality_score  FLOAT,

  -- End-to-end scan latency in milliseconds
  latency_ms           INTEGER,

  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scan_logs_vendor_id    ON scan_logs (vendor_id);
CREATE INDEX idx_scan_logs_created_at   ON scan_logs (created_at DESC);
CREATE INDEX idx_scan_logs_vision_model ON scan_logs (vision_model);

ALTER TABLE scan_logs ENABLE ROW LEVEL SECURITY;

-- Vendors can insert their own scan logs
CREATE POLICY "Vendor inserts own scan logs"
  ON scan_logs FOR INSERT
  WITH CHECK (auth.uid() = vendor_id);

-- Vendors can read their own scan logs
CREATE POLICY "Vendor reads own scan logs"
  ON scan_logs FOR SELECT
  USING (auth.uid() = vendor_id);

-- ============================================
-- STEP 9: also refresh match_cards function for new cards schema
-- (column card_number renamed to number — must DROP first because return type changed)
-- ============================================
DROP FUNCTION IF EXISTS match_cards(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION match_cards(
  p_name        TEXT,
  p_set_hint    TEXT DEFAULT NULL,
  p_number_hint TEXT DEFAULT NULL
)
RETURNS TABLE (
  id            TEXT,
  name          TEXT,
  set_name      TEXT,
  number        TEXT,
  image_small   TEXT,
  score         REAL
)
LANGUAGE sql STABLE AS $$
  SELECT
    c.id,
    c.name,
    c.set_name,
    c.number,
    c.image_small,
    (
      similarity(c.name, p_name)
      + CASE WHEN p_set_hint    IS NOT NULL AND c.set_name ILIKE '%' || p_set_hint    || '%' THEN 0.2 ELSE 0 END
      + CASE WHEN p_number_hint IS NOT NULL AND c.number   =           p_number_hint             THEN 0.3 ELSE 0 END
    )::real AS score
  FROM cards c
  WHERE similarity(c.name, p_name) > 0.2
  ORDER BY score DESC
  LIMIT 3;
$$;

GRANT EXECUTE ON FUNCTION match_cards(TEXT, TEXT, TEXT) TO authenticated;
