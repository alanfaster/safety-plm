-- Artifact versioning: monotonically incrementing version on every artifact table.
-- version starts at 1 on INSERT and increments by 1 on every UPDATE (via trigger).

ALTER TABLE requirements        ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE arch_spec_items     ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE vcycle_docs         ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE safety_analysis_rows ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE test_specs          ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Denormalized version on snapshots for quick display (already in snapshot_data JSONB,
-- but useful to have as a typed column for filtering/display without parsing JSON)
ALTER TABLE review_artifact_snapshots ADD COLUMN IF NOT EXISTS artifact_version INTEGER;

-- Trigger function (shared by all tables)
CREATE OR REPLACE FUNCTION increment_artifact_version()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.version = OLD.version + 1;
  RETURN NEW;
END;
$$;

-- Apply trigger to each artifact table
DROP TRIGGER IF EXISTS trg_version ON requirements;
CREATE TRIGGER trg_version
  BEFORE UPDATE ON requirements
  FOR EACH ROW EXECUTE FUNCTION increment_artifact_version();

DROP TRIGGER IF EXISTS trg_version ON arch_spec_items;
CREATE TRIGGER trg_version
  BEFORE UPDATE ON arch_spec_items
  FOR EACH ROW EXECUTE FUNCTION increment_artifact_version();

DROP TRIGGER IF EXISTS trg_version ON vcycle_docs;
CREATE TRIGGER trg_version
  BEFORE UPDATE ON vcycle_docs
  FOR EACH ROW EXECUTE FUNCTION increment_artifact_version();

DROP TRIGGER IF EXISTS trg_version ON safety_analysis_rows;
CREATE TRIGGER trg_version
  BEFORE UPDATE ON safety_analysis_rows
  FOR EACH ROW EXECUTE FUNCTION increment_artifact_version();

DROP TRIGGER IF EXISTS trg_version ON test_specs;
CREATE TRIGGER trg_version
  BEFORE UPDATE ON test_specs
  FOR EACH ROW EXECUTE FUNCTION increment_artifact_version();
