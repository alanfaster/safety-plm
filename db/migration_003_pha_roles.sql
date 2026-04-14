-- migration_003_pha_roles.sql
-- Hazards (PHL/PHA), project config (customizable fields), roles

-- ── User profiles (app-admin flag) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  is_app_admin BOOLEAN NOT NULL DEFAULT false,
  display_name TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_profiles"  ON user_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_own_profile"    ON user_profiles FOR ALL    TO authenticated USING (auth.uid() = user_id);

-- ── Project members (project-level roles) ────────────────────────────────────
-- Roles: 'admin' (full), 'editor' (edit, no delete/rename project), 'viewer' (read-only)
CREATE TABLE IF NOT EXISTS project_members (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
  invited_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, user_id)
);
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_members"  ON project_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_members" ON project_members FOR ALL    TO authenticated USING (true);

-- ── Project config (customizable settings per project) ───────────────────────
-- config JSONB schema:
--   { "pha_fields": { "<field_key>": { "visible": bool, "label": str } }, ... }
CREATE TABLE IF NOT EXISTS project_config (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE UNIQUE,
  config     JSONB NOT NULL DEFAULT '{}',
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE project_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_config"  ON project_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_config" ON project_config FOR ALL    TO authenticated USING (true);

-- ── Hazards (PHL / PHA entries) ──────────────────────────────────────────────
-- One hazard per row; linked to a specific Use Case (nullable for free-standing hazards)
-- All field values stored in JSONB `data` for flexibility with project_config
CREATE TABLE IF NOT EXISTS hazards (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  haz_code    TEXT NOT NULL,
  project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
  parent_type TEXT NOT NULL CHECK (parent_type IN ('item','system')),
  parent_id   UUID NOT NULL,
  use_case_id UUID REFERENCES use_cases(id) ON DELETE SET NULL,
  data        JSONB NOT NULL DEFAULT '{}',   -- stores all PHA field values
  sort_order  INT NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','closed','n/a')),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hazards_parent  ON hazards(parent_type, parent_id);
CREATE INDEX IF NOT EXISTS idx_hazards_project ON hazards(project_id);
CREATE INDEX IF NOT EXISTS idx_hazards_uc      ON hazards(use_case_id);

ALTER TABLE hazards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_hazards"  ON hazards FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_hazards" ON hazards FOR ALL    TO authenticated USING (true);

-- ── Back-fill: auto-assign creator as admin of existing projects ──────────────
-- Run this once to register existing project creators as admins:
-- INSERT INTO project_members (project_id, user_id, role)
-- SELECT id, created_by, 'admin' FROM projects WHERE created_by IS NOT NULL
-- ON CONFLICT DO NOTHING;
