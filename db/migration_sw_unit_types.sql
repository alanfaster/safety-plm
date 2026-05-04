-- Add unit_type to sw_units
ALTER TABLE sw_units
  ADD COLUMN IF NOT EXISTS unit_type TEXT DEFAULT 'general';
