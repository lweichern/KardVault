-- Migration 00008: Tiered scan waterfall support (CLAUDE-enhance.md §7)
-- Adds: card_hashes (Tier 1 perceptual hash index), scan_events (per-attempt
-- telemetry for threshold calibration), scan_corrections (human-confirm error
-- dataset). Existing tables are not touched.

-- ============================================
-- CARD HASHES — perceptual hash per catalog card/printing
-- Hashes are 64-bit pHashes stored as 16-char lowercase hex strings.
-- Written only by the service-role hashing job (scripts/hash-catalog.ts).
-- ============================================
CREATE TABLE card_hashes (
  game        TEXT NOT NULL DEFAULT 'pokemon',
  card_id     TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  printing_id TEXT NOT NULL DEFAULT '',
  hash_full   TEXT NOT NULL,   -- pHash of the full card image
  hash_art    TEXT,            -- pHash of the artwork region only
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (game, card_id, printing_id)
);

CREATE INDEX idx_card_hashes_game ON card_hashes (game);

ALTER TABLE card_hashes ENABLE ROW LEVEL SECURITY;

-- Reference data: public read, service-role-only writes (no insert/update policies)
CREATE POLICY "Anyone can read card_hashes"
  ON card_hashes FOR SELECT
  USING (true);

-- ============================================
-- SCAN EVENTS — every scan attempt, for calibration + analytics
-- ============================================
CREATE TABLE scan_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id          UUID REFERENCES vendors(id) ON DELETE CASCADE,
  session_id         UUID,
  mode               TEXT CHECK (mode IN ('photo', 'video', 'flatlay', 'quick')),
  tier_resolved      INT,              -- 1..4, NULL = failed entirely
  auto_accepted      BOOLEAN NOT NULL DEFAULT false,
  hash_best_distance INT,
  hash_margin        INT,
  ocr_parsed         BOOLEAN,
  gemini_called      BOOLEAN NOT NULL DEFAULT false,
  resolved_card_id   TEXT REFERENCES cards(id),
  candidates         JSONB,            -- [{card_id, source, distance?}] shown/considered
  latency_ms         INTEGER,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scan_events_vendor_time ON scan_events (vendor_id, created_at DESC);
CREATE INDEX idx_scan_events_tier        ON scan_events (tier_resolved);

ALTER TABLE scan_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendor inserts own scan events"
  ON scan_events FOR INSERT
  WITH CHECK (auth.uid() = vendor_id);

CREATE POLICY "Vendor reads own scan events"
  ON scan_events FOR SELECT
  USING (auth.uid() = vendor_id);

-- ============================================
-- SCAN CORRECTIONS — human corrections = error dataset
-- ============================================
CREATE TABLE scan_corrections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_event_id    UUID REFERENCES scan_events(id) ON DELETE CASCADE,
  candidates_shown JSONB,
  chosen_card_id   TEXT NOT NULL REFERENCES cards(id),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scan_corrections_event ON scan_corrections (scan_event_id);

ALTER TABLE scan_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendor inserts corrections for own scan events"
  ON scan_corrections FOR INSERT
  WITH CHECK (
    scan_event_id IN (SELECT id FROM scan_events WHERE vendor_id = auth.uid())
  );

CREATE POLICY "Vendor reads corrections for own scan events"
  ON scan_corrections FOR SELECT
  USING (
    scan_event_id IN (SELECT id FROM scan_events WHERE vendor_id = auth.uid())
  );
