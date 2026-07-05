-- Migration 00009: TCGplayer price data via TCGCSV (CLAUDE-enhance.md §5.1)
-- Pokémon = category 3. Synced by scripts/sync-tcgcsv.ts (service role).
-- Covers BOTH singles and sealed products — sealed is what Snap & Sell prices.

-- ============================================
-- TCG GROUPS — TCGplayer's "groups" ≈ sets/products lines (217 for Pokémon)
-- ============================================
CREATE TABLE tcg_groups (
  group_id        INTEGER PRIMARY KEY,          -- TCGplayer groupId
  name            TEXT NOT NULL,                -- e.g. "ME: 30th Celebration"
  abbreviation    TEXT,                         -- e.g. "30C"
  is_supplemental BOOLEAN NOT NULL DEFAULT false,
  published_on    TIMESTAMPTZ,
  category_id     INTEGER NOT NULL DEFAULT 3,   -- 3 = Pokémon
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tcg_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read tcg_groups" ON tcg_groups FOR SELECT USING (true);

-- ============================================
-- TCG PRODUCTS — singles AND sealed (boxes, ETBs, tins, bundles)
-- ============================================
CREATE TABLE tcg_products (
  product_id  INTEGER PRIMARY KEY,              -- TCGplayer productId
  group_id    INTEGER NOT NULL REFERENCES tcg_groups(group_id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  clean_name  TEXT,
  image_url   TEXT,
  url         TEXT,
  -- extendedData "Number" e.g. "021/128" — present on singles only
  card_number TEXT,
  rarity      TEXT,
  -- No card number in extendedData → sealed product / accessory
  is_sealed   BOOLEAN NOT NULL DEFAULT false,
  -- Optional link to our cards catalog (filled by a later mapping job)
  card_id     TEXT REFERENCES cards(id),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tcg_products_group     ON tcg_products (group_id);
CREATE INDEX idx_tcg_products_sealed    ON tcg_products (is_sealed);
CREATE INDEX idx_tcg_products_card_id   ON tcg_products (card_id);
CREATE INDEX idx_tcg_products_number    ON tcg_products (card_number);
-- Fuzzy name matching (Snap & Sell identification, card mapping)
CREATE INDEX idx_tcg_products_name_trgm ON tcg_products USING gin (name gin_trgm_ops);

ALTER TABLE tcg_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read tcg_products" ON tcg_products FOR SELECT USING (true);

-- ============================================
-- TCG PRICES — one row per (product, printing variant), upserted daily.
-- USD as published by TCGplayer; convert to MYR at display time.
-- ============================================
CREATE TABLE tcg_prices (
  product_id       INTEGER NOT NULL REFERENCES tcg_products(product_id) ON DELETE CASCADE,
  sub_type_name    TEXT NOT NULL DEFAULT 'Normal', -- Normal | Holofoil | Reverse Holofoil | 1st Edition …
  market_price     NUMERIC(10,2),
  low_price        NUMERIC(10,2),
  mid_price        NUMERIC(10,2),
  high_price       NUMERIC(10,2),
  direct_low_price NUMERIC(10,2),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (product_id, sub_type_name)
);

CREATE INDEX idx_tcg_prices_updated ON tcg_prices (updated_at);

ALTER TABLE tcg_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read tcg_prices" ON tcg_prices FOR SELECT USING (true);
