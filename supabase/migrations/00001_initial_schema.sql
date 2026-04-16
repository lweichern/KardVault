-- KardVault initial schema
-- Tables: vendors, cards, inventory, transactions
-- All tables use Row Level Security (RLS)

-- Enable trigram extension for fuzzy card name matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================
-- VENDORS
-- ============================================
CREATE TABLE vendors (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  whatsapp_number TEXT NOT NULL,
  profile_image_url TEXT,
  banner_image_url TEXT,
  bio TEXT,
  slug TEXT UNIQUE NOT NULL,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro')),
  tier_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for vendors
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

-- Vendors can read their own full row
CREATE POLICY "Vendors can read own"
  ON vendors FOR SELECT
  USING (auth.uid() = id);

-- Vendors can update their own row
CREATE POLICY "Vendors can update own"
  ON vendors FOR UPDATE
  USING (auth.uid() = id);

-- Vendors can insert their own row (onboarding)
CREATE POLICY "Vendors can insert own"
  ON vendors FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Public can read storefront-relevant fields (use a view for field filtering)
CREATE POLICY "Public can read vendor storefronts"
  ON vendors FOR SELECT
  USING (true);

-- ============================================
-- CARDS (reference data — populated by cron)
-- ============================================
CREATE TABLE cards (
  id TEXT PRIMARY KEY,                    -- Pokémon TCG API card ID (e.g. sv1-25)
  name TEXT NOT NULL,
  set_id TEXT NOT NULL,
  set_name TEXT NOT NULL,
  card_number TEXT NOT NULL,              -- Printed number (e.g. 025/198)
  rarity TEXT,
  image_small TEXT,
  image_large TEXT,
  supertype TEXT,                         -- Pokémon, Trainer, Energy
  subtypes TEXT[],
  tcgplayer_market_price DECIMAL(10,2),
  market_price_rm DECIMAL(10,2),
  price_updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigram index for fuzzy name search (autocomplete)
CREATE INDEX idx_cards_name_trgm ON cards USING gin (name gin_trgm_ops);

-- Index for card number lookups (OCR results)
CREATE INDEX idx_cards_card_number ON cards (card_number);

-- Index for set-based filtering
CREATE INDEX idx_cards_set_id ON cards (set_id);

-- RLS for cards — public read-only
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read cards"
  ON cards FOR SELECT
  USING (true);

-- ============================================
-- INVENTORY
-- ============================================
CREATE TABLE inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards(id),
  condition TEXT NOT NULL DEFAULT 'NM' CHECK (condition IN ('NM', 'LP', 'MP', 'HP', 'DMG')),
  quantity INTEGER NOT NULL DEFAULT 1,
  buy_price_rm DECIMAL(10,2),
  sell_price_rm DECIMAL(10,2) NOT NULL,
  condition_photo_url TEXT,
  listed_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (vendor_id, card_id, condition)
);

-- Indexes for inventory queries
CREATE INDEX idx_inventory_vendor_id ON inventory (vendor_id);
CREATE INDEX idx_inventory_card_id ON inventory (card_id);

-- RLS for inventory
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;

-- Vendor full CRUD on own rows
CREATE POLICY "Vendor manages own inventory"
  ON inventory FOR ALL
  USING (auth.uid() = vendor_id);

-- Public can read inventory (for storefronts)
CREATE POLICY "Public can read inventory"
  ON inventory FOR SELECT
  USING (true);

-- ============================================
-- TRANSACTIONS (buy/sell log for profit tracking)
-- ============================================
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards(id),
  type TEXT NOT NULL CHECK (type IN ('buy', 'sell')),
  quantity INTEGER NOT NULL DEFAULT 1,
  price_rm DECIMAL(10,2) NOT NULL,
  market_price_at_time DECIMAL(10,2),
  condition TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for transaction queries
CREATE INDEX idx_transactions_vendor_id ON transactions (vendor_id);
CREATE INDEX idx_transactions_created_at ON transactions (created_at);

-- RLS for transactions — vendor-only, no public access
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendor manages own transactions"
  ON transactions FOR ALL
  USING (auth.uid() = vendor_id);

-- ============================================
-- PUBLIC STOREFRONT VIEW
-- Limits which vendor fields are exposed publicly
-- ============================================
CREATE OR REPLACE VIEW public_vendors AS
SELECT
  id,
  display_name,
  slug,
  profile_image_url,
  banner_image_url,
  bio
FROM vendors;
