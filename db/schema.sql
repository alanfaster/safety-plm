-- ============================================================
-- Safety ALM/PLM - Database Schema
-- ============================================================

-- Projects
CREATE TABLE projects (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('automotive', 'aerospace', 'military')),
  norm        TEXT,
  description TEXT,
  status      TEXT DEFAULT 'active',
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Project user permissions
CREATE TABLE project_permissions (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES auth.users(id),
  role       TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'admin')),
  UNIQUE(project_id, user_id)
);

-- Items (top-level product/system under a project)
CREATE TABLE items (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  item_code  TEXT NOT NULL,  -- e.g. ITM-A3B2C1
  name       TEXT NOT NULL,
  description TEXT,
  status     TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Systems (sub-components of an item)
CREATE TABLE systems (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id     UUID REFERENCES items(id) ON DELETE CASCADE,
  system_code TEXT NOT NULL,  -- e.g. SYS-A3B2C1
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT DEFAULT 'draft',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Requirements (belong to item OR system)
CREATE TABLE requirements (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  req_code    TEXT NOT NULL,   -- e.g. REQ-A3B2C1
  parent_type TEXT NOT NULL CHECK (parent_type IN ('item', 'system')),
  parent_id   UUID NOT NULL,
  project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  type        TEXT DEFAULT 'functional' CHECK (type IN ('functional', 'performance', 'safety', 'interface', 'constraint')),
  status      TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'deprecated')),
  priority    TEXT DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  asil        TEXT,  -- automotive: QM, ASIL-A/B/C/D
  dal         TEXT,  -- aerospace: DAL-A/B/C/D/E
  source      TEXT,
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- V-cycle phase documents (one per phase per parent)
CREATE TABLE vcycle_docs (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_type TEXT NOT NULL CHECK (parent_type IN ('item', 'system')),
  parent_id   UUID NOT NULL,
  project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
  phase       TEXT NOT NULL CHECK (phase IN (
    'item_definition', 'requirements', 'architecture', 'design',
    'implementation', 'unit_testing', 'integration_testing',
    'system_testing', 'validation'
  )),
  content     JSONB DEFAULT '{}',
  status      TEXT DEFAULT 'draft',
  updated_at  TIMESTAMPTZ DEFAULT now(),
  updated_by  UUID REFERENCES auth.users(id),
  UNIQUE(parent_type, parent_id, phase)
);

-- Safety analyses headers
CREATE TABLE safety_analyses (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  analysis_code   TEXT NOT NULL,  -- e.g. SAF-A3B2C1
  parent_type     TEXT NOT NULL CHECK (parent_type IN ('item', 'system')),
  parent_id       UUID NOT NULL,
  project_id      UUID REFERENCES projects(id) ON DELETE CASCADE,
  analysis_type   TEXT NOT NULL,  -- HARA, FSC, TSC, FTA, FMEA, PHL_PHA, FHA
  title           TEXT,
  description     TEXT,
  content         JSONB DEFAULT '{}',  -- metadata, diagram data (FTA), etc.
  status          TEXT DEFAULT 'draft',
  updated_at      TIMESTAMPTZ DEFAULT now(),
  updated_by      UUID REFERENCES auth.users(id),
  UNIQUE(parent_type, parent_id, analysis_type)
);

-- Safety analysis rows (table rows for FMEA, HARA, FHA, etc.)
CREATE TABLE safety_analysis_rows (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  analysis_id UUID REFERENCES safety_analyses(id) ON DELETE CASCADE,
  row_order   INTEGER DEFAULT 0,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- RLS Policies
-- ============================================================
ALTER TABLE projects               ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_permissions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE items                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE systems                ENABLE ROW LEVEL SECURITY;
ALTER TABLE requirements           ENABLE ROW LEVEL SECURITY;
ALTER TABLE vcycle_docs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_analyses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_analysis_rows   ENABLE ROW LEVEL SECURITY;

-- Authenticated users can access all data (project-level permissions handled in app)
CREATE POLICY "auth_all_projects"            ON projects             FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all_permissions"         ON project_permissions  FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all_items"               ON items                FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all_systems"             ON systems              FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all_requirements"        ON requirements         FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all_vcycle"              ON vcycle_docs          FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all_safety_analyses"     ON safety_analyses      FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all_safety_rows"         ON safety_analysis_rows FOR ALL USING (auth.role() = 'authenticated');
