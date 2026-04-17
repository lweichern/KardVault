-- Events
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  city TEXT NOT NULL CHECK (city IN ('KL','PJ','Penang','JB','Ipoh','Kuching','Kota Kinabalu','Melaka')),
  venue TEXT,
  date DATE NOT NULL,
  end_date DATE,
  source TEXT NOT NULL DEFAULT 'community' CHECK (source IN ('official', 'community')),
  created_by UUID REFERENCES vendors(id),
  flagged_count INTEGER NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_name_trgm ON events USING gin (name gin_trgm_ops);
CREATE INDEX idx_events_upcoming ON events (city, date) WHERE deleted_at IS NULL;

-- Event vendors (join table)
CREATE TABLE event_vendors (
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
  booth_info TEXT,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (event_id, vendor_id)
);

-- Event flags
CREATE TABLE event_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  flagged_by UUID NOT NULL REFERENCES vendors(id),
  reason TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read events" ON events FOR SELECT USING (deleted_at IS NULL);
CREATE POLICY "Authenticated can create events" ON events FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Creator can update own community event" ON events FOR UPDATE USING (auth.uid() = created_by AND source = 'community');
CREATE POLICY "Creator can delete own community event" ON events FOR DELETE USING (auth.uid() = created_by AND source = 'community');

ALTER TABLE event_vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read event vendors" ON event_vendors FOR SELECT USING (true);
CREATE POLICY "Vendor can join events" ON event_vendors FOR INSERT WITH CHECK (auth.uid() = vendor_id);
CREATE POLICY "Vendor can leave events" ON event_vendors FOR DELETE USING (auth.uid() = vendor_id);
CREATE POLICY "Vendor can update own booth info" ON event_vendors FOR UPDATE USING (auth.uid() = vendor_id);

ALTER TABLE event_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vendor can flag events" ON event_flags FOR INSERT WITH CHECK (auth.uid() = flagged_by);
CREATE POLICY "Vendor can read own flags" ON event_flags FOR SELECT USING (auth.uid() = flagged_by);

-- RPC for duplicate detection: fuzzy name match + same city/date
CREATE OR REPLACE FUNCTION find_similar_events(p_name TEXT, p_city TEXT, p_date DATE)
RETURNS TABLE (id UUID, name TEXT, city TEXT, date DATE, end_date DATE, venue TEXT, source TEXT, score REAL)
LANGUAGE sql STABLE
AS $$
  SELECT e.id, e.name, e.city, e.date, e.end_date, e.venue, e.source,
         similarity(e.name, p_name)::REAL AS score
  FROM events e
  WHERE e.deleted_at IS NULL
    AND e.city = p_city
    AND e.date BETWEEN p_date - INTERVAL '3 days' AND p_date + INTERVAL '3 days'
    AND similarity(e.name, p_name) > 0.3
  ORDER BY score DESC
  LIMIT 5;
$$;
