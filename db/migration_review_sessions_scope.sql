-- Add scope fields to review_sessions so sessions can be item-level, system-level, or domain-level.
-- item_id:   always set (the item this session belongs to)
-- system_id: set when the session is scoped to a specific system (nullable = item-level)
-- domain:    set when the session is scoped to a specific domain sw/hw/mech (nullable = all domains)

ALTER TABLE review_sessions
  ADD COLUMN IF NOT EXISTS item_id   UUID REFERENCES items(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS system_id UUID REFERENCES systems(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS domain    TEXT;

CREATE INDEX IF NOT EXISTS idx_rs_item   ON review_sessions (item_id);
CREATE INDEX IF NOT EXISTS idx_rs_system ON review_sessions (system_id);
