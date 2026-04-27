-- ============================================================
-- Review Protocol System
-- IEEE 1028 / ASPICE MAN.5 / SWE.6 aligned
-- ============================================================

-- 1. REVIEW PROTOCOL TEMPLATES
CREATE TABLE IF NOT EXISTS review_protocol_templates (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
    -- 'requirements' | 'arch_spec_items' | 'test_specs' | 'safety_analysis_rows' | 'vcycle_docs'
  review_type   TEXT NOT NULL DEFAULT 'inspection',
    -- 'inspection' | 'walkthrough' | 'technical_review' | 'audit' | 'management_review'
  description   TEXT,
  is_active     BOOLEAN DEFAULT true,
  created_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS review_template_sections (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id UUID REFERENCES review_protocol_templates(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS review_template_items (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  section_id   UUID REFERENCES review_template_sections(id) ON DELETE CASCADE,
  template_id  UUID REFERENCES review_protocol_templates(id) ON DELETE CASCADE,
  criterion    TEXT NOT NULL,
  guidance     TEXT,
  is_mandatory BOOLEAN DEFAULT false,
  sort_order   INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- 2. REVIEW SESSIONS
CREATE TABLE IF NOT EXISTS review_sessions (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  template_id   UUID REFERENCES review_protocol_templates(id),
  title         TEXT NOT NULL,
  review_type   TEXT NOT NULL DEFAULT 'inspection',
  status        TEXT NOT NULL DEFAULT 'planned'
                CHECK (status IN ('planned','in_progress','completed','cancelled')),
  planned_date  DATE,
  completed_at  TIMESTAMPTZ,
  created_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS review_session_reviewers (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES review_sessions(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES auth.users(id),
  role       TEXT DEFAULT 'reviewer'
    -- 'moderator' | 'reviewer' | 'author' | 'scribe'
);

-- 3. ARTIFACT SNAPSHOTS (immutable at review start)
-- Multiple snapshots per artifact per session allowed (re-snapshot after author edits)
CREATE TABLE IF NOT EXISTS review_artifact_snapshots (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id          UUID REFERENCES review_sessions(id) ON DELETE CASCADE,
  artifact_type       TEXT NOT NULL,
  artifact_id         UUID NOT NULL,
  artifact_code       TEXT,
  artifact_title      TEXT,
  snapshot_data       JSONB NOT NULL,       -- full artifact row at snapshot time (write-once)
  artifact_updated_at TIMESTAMPTZ,          -- copy of artifact.updated_at at snapshot time (drift detection)
  is_current          BOOLEAN DEFAULT true, -- false = superseded by a newer re-snapshot
  snapshotted_at      TIMESTAMPTZ DEFAULT now(),
  snapshotted_by      UUID REFERENCES auth.users(id)
);

-- 4. CHECKLIST RESPONSES (one row per reviewer per item per snapshot)
CREATE TABLE IF NOT EXISTS review_checklist_responses (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id       UUID REFERENCES review_sessions(id) ON DELETE CASCADE,
  snapshot_id      UUID REFERENCES review_artifact_snapshots(id) ON DELETE CASCADE,
  template_item_id UUID REFERENCES review_template_items(id),
  reviewer_id      UUID REFERENCES auth.users(id),
  verdict          TEXT CHECK (verdict IN ('ok','nok','partially_ok','na')),
  comment          TEXT,
  is_stale         BOOLEAN DEFAULT false,   -- true when snapshot was superseded after this response
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (snapshot_id, template_item_id, reviewer_id)
);

-- 5. FINDINGS
CREATE TABLE IF NOT EXISTS review_findings (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id      UUID REFERENCES review_sessions(id) ON DELETE CASCADE,
  snapshot_id     UUID REFERENCES review_artifact_snapshots(id),
  response_id     UUID REFERENCES review_checklist_responses(id),
  finding_code    TEXT NOT NULL,
  severity        TEXT DEFAULT 'major'
                  CHECK (severity IN ('critical','major','minor','observation')),
  title           TEXT NOT NULL,
  description     TEXT,
  status          TEXT DEFAULT 'open'
                  CHECK (status IN ('open','accepted','in_progress','deferred','fixed','verified','closed','duplicate','rejected')),
  assigned_to     UUID REFERENCES auth.users(id),
  due_date        DATE,
  resolution_note TEXT,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE review_protocol_templates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_template_sections    ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_template_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_sessions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_session_reviewers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_artifact_snapshots   ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_checklist_responses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_findings             ENABLE ROW LEVEL SECURITY;

-- Permissive policies (authenticated, project-scoped via app logic — same pattern as rest of app)
CREATE POLICY "auth_all" ON review_protocol_templates  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON review_template_sections   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON review_template_items      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON review_sessions            FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON review_session_reviewers   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON review_artifact_snapshots  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON review_checklist_responses FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON review_findings            FOR ALL TO authenticated USING (true) WITH CHECK (true);
