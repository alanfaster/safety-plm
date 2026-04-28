-- Project roles (ASPICE / IEEE 1028 aligned)
CREATE TABLE IF NOT EXISTS project_roles (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  code        TEXT,            -- short code, e.g. 'SWE', 'QA', 'MOD'
  category    TEXT NOT NULL DEFAULT 'development',
                               -- 'development'|'quality'|'management'|'review'
  description TEXT,
  sort_order  INTEGER DEFAULT 0,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Project members: user ↔ role assignment within a project
CREATE TABLE IF NOT EXISTS project_members (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id    UUID REFERENCES project_roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (project_id, user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_project_roles_project   ON project_roles   (project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members (project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user    ON project_members (user_id);

ALTER TABLE project_roles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'project_roles' AND policyname = 'auth_all') THEN
    CREATE POLICY auth_all ON project_roles   FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'project_members' AND policyname = 'auth_all') THEN
    CREATE POLICY auth_all ON project_members FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
