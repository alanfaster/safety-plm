-- Review Protocol Template Versioning
-- Run after migration_review_protocols.sql

-- Add version counter to templates (default 1 = initial draft, not yet published)
ALTER TABLE review_protocol_templates
  ADD COLUMN IF NOT EXISTS current_version INTEGER DEFAULT 0;
  -- 0 = never published; ≥1 = published versions exist

-- Immutable version snapshots
CREATE TABLE IF NOT EXISTS review_template_versions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id UUID REFERENCES review_protocol_templates(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  notes       TEXT,
  snapshot    JSONB NOT NULL,
  -- { name, artifact_type, review_type, description,
  --   sections: [{ name, items: [{ criterion, guidance, is_mandatory }] }] }
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (template_id, version)
);

ALTER TABLE review_template_versions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'review_template_versions' AND policyname = 'auth_all'
  ) THEN
    CREATE POLICY auth_all ON review_template_versions
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rtv_template ON review_template_versions (template_id, version);

-- Track which protocol version was active when a review session was created
ALTER TABLE review_sessions
  ADD COLUMN IF NOT EXISTS template_version INTEGER;
