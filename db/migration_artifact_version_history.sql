-- Artifact version history: stores the full state of an artifact before each change.
-- Each UPDATE triggers a history insert (OLD row) then increments the version counter.

CREATE TABLE IF NOT EXISTS artifact_version_history (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  artifact_type TEXT NOT NULL,   -- matches TG_TABLE_NAME: requirements, arch_spec_items, etc.
  artifact_id   UUID NOT NULL,
  version       INTEGER NOT NULL,
  data          JSONB NOT NULL,  -- full row at this version (the "before" state)
  changed_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_avh_artifact ON artifact_version_history (artifact_type, artifact_id, version);

ALTER TABLE artifact_version_history ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'artifact_version_history' AND policyname = 'auth_all'
  ) THEN
    CREATE POLICY auth_all ON artifact_version_history FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Replace the increment trigger function to also record history
CREATE OR REPLACE FUNCTION increment_artifact_version()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO artifact_version_history (artifact_type, artifact_id, version, data, changed_at)
  VALUES (TG_TABLE_NAME, OLD.id, OLD.version, to_jsonb(OLD), now());
  NEW.version = OLD.version + 1;
  RETURN NEW;
END;
$$;
