-- SW Units: source code artifacts with version tracking and drift detection
-- Aligned with ASPICE SWE.3 (SW Detailed Design) / SWE.4 (SW Unit Verification)

CREATE TABLE IF NOT EXISTS sw_units (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  parent_type   TEXT NOT NULL CHECK (parent_type IN ('item','system')),
  parent_id     UUID NOT NULL,
  unit_code     TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  source_code   TEXT,
  file_path     TEXT,
  language      TEXT,
  content_hash  TEXT,
  version       INTEGER DEFAULT 1,
  needs_review  BOOLEAN DEFAULT false,
  status        TEXT DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved','deprecated')),
  created_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sw_unit_versions (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sw_unit_id    UUID REFERENCES sw_units(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  source_code   TEXT,
  content_hash  TEXT,
  file_path     TEXT,
  uploaded_by   UUID REFERENCES auth.users(id),
  uploaded_at   TIMESTAMPTZ DEFAULT now()
);

-- Extend review_sessions for external review mode
ALTER TABLE review_sessions
  ADD COLUMN IF NOT EXISTS review_mode TEXT DEFAULT 'internal'
    CHECK (review_mode IN ('internal','external')),
  ADD COLUMN IF NOT EXISTS external_evidence_url TEXT,
  ADD COLUMN IF NOT EXISTS external_evidence_notes TEXT;

-- Add line_number to findings for inline code comments (Phase 4)
ALTER TABLE review_findings
  ADD COLUMN IF NOT EXISTS line_number INTEGER;

ALTER TABLE sw_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE sw_unit_versions ENABLE ROW LEVEL SECURITY;

-- RLS: project members can read/write sw_units for their projects
CREATE POLICY sw_units_policy ON sw_units
  USING (project_id IN (
    SELECT project_id FROM project_members WHERE user_id = auth.uid()
    UNION SELECT id FROM projects WHERE created_by = auth.uid()
  ));

CREATE POLICY sw_unit_versions_policy ON sw_unit_versions
  USING (sw_unit_id IN (
    SELECT id FROM sw_units WHERE project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
      UNION SELECT id FROM projects WHERE created_by = auth.uid()
    )
  ));
