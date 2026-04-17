-- Storefront analytics: track buyer views and searches

CREATE TABLE storefront_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards(id),
  viewed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_storefront_views_vendor_card ON storefront_views (vendor_id, card_id);
CREATE INDEX idx_storefront_views_vendor_time ON storefront_views (vendor_id, viewed_at);

ALTER TABLE storefront_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert views" ON storefront_views FOR INSERT WITH CHECK (true);
CREATE POLICY "Vendors read own views" ON storefront_views FOR SELECT USING (auth.uid() = vendor_id);

CREATE TABLE storefront_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  results_count INTEGER NOT NULL DEFAULT 0,
  searched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_storefront_searches_vendor_time ON storefront_searches (vendor_id, searched_at);

ALTER TABLE storefront_searches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert searches" ON storefront_searches FOR INSERT WITH CHECK (true);
CREATE POLICY "Vendors read own searches" ON storefront_searches FOR SELECT USING (auth.uid() = vendor_id);
