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
