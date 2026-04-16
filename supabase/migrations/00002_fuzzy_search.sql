-- Ensure pg_trgm is enabled (idempotent — safe to re-run)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Fuzzy card search function for autocomplete
-- Returns cards matching a query string, ordered by similarity.
-- Usage: SELECT * FROM search_cards('charizard', 10);
CREATE OR REPLACE FUNCTION search_cards(
  query TEXT,
  result_limit INTEGER DEFAULT 20
)
RETURNS SETOF cards
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM cards
  WHERE
    name ILIKE '%' || query || '%'
    OR similarity(name, query) > 0.2
  ORDER BY
    -- Exact prefix match first
    CASE WHEN name ILIKE query || '%' THEN 0 ELSE 1 END,
    -- Then by trigram similarity
    similarity(name, query) DESC
  LIMIT result_limit;
$$;

-- Ensure trigram index exists (idempotent)
CREATE INDEX IF NOT EXISTS idx_cards_name_trgm
  ON cards USING gin (name gin_trgm_ops);
