-- migration_002_feat_uc_fun.sql
-- Features, Use Cases, Functions
-- Scoped by parent (item/system) + domain (system/sw/hw/mech/item)
-- Hierarchy: Feature → Use Case → Function
-- Referenced by Item Definition page and Safety Analysis

-- ── Features ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS features (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  feat_code   TEXT NOT NULL,
  parent_type TEXT NOT NULL CHECK (parent_type IN ('item', 'system')),
  parent_id   UUID NOT NULL,
  domain      TEXT NOT NULL DEFAULT 'system',
  project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ── Use Cases ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS use_cases (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  uc_code     TEXT NOT NULL,
  feature_id  UUID REFERENCES features(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ── Functions ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS functions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  func_code   TEXT NOT NULL,
  use_case_id UUID REFERENCES use_cases(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_features_parent  ON features(parent_type, parent_id, domain);
CREATE INDEX IF NOT EXISTS idx_use_cases_feat   ON use_cases(feature_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_functions_uc     ON functions(use_case_id, sort_order);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE features  ENABLE ROW LEVEL SECURITY;
ALTER TABLE use_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE functions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_features"   ON features  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_features"  ON features  FOR ALL    TO authenticated USING (true);
CREATE POLICY "auth_read_use_cases"  ON use_cases FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_use_cases" ON use_cases FOR ALL    TO authenticated USING (true);
CREATE POLICY "auth_read_functions"  ON functions FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_functions" ON functions FOR ALL    TO authenticated USING (true);
