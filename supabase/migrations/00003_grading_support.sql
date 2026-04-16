-- Add grading support to inventory
-- Graded cards (PSA, BGS, CGC, ACE) are tracked separately from raw cards

ALTER TABLE inventory ADD COLUMN grading_company TEXT;
ALTER TABLE inventory ADD COLUMN grade TEXT;

-- Drop old unique constraint and create new one that includes grading
ALTER TABLE inventory DROP CONSTRAINT inventory_vendor_id_card_id_condition_key;

CREATE UNIQUE INDEX idx_inventory_unique_entry
  ON inventory (vendor_id, card_id, condition, COALESCE(grading_company, ''), COALESCE(grade, ''));
