-- ============================================================
-- Migration 001 — Run FULL file in Supabase SQL Editor
-- ============================================================

-- 0. Add item_name to projects (shown on project card)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS item_name TEXT;

-- 1. Add num_systems to items
ALTER TABLE items ADD COLUMN IF NOT EXISTS num_systems INT NOT NULL DEFAULT 1;

-- 2. Add columns to vcycle_docs (must exist before constraints)
ALTER TABLE vcycle_docs ADD COLUMN IF NOT EXISTS domain     TEXT NOT NULL DEFAULT 'default';
ALTER TABLE vcycle_docs ADD COLUMN IF NOT EXISTS nav_page_id UUID;

-- 3. Update unique constraint (now both columns exist)
ALTER TABLE vcycle_docs DROP CONSTRAINT IF EXISTS vcycle_docs_parent_type_parent_id_phase_key;
ALTER TABLE vcycle_docs DROP CONSTRAINT IF EXISTS vcycle_docs_unique;
ALTER TABLE vcycle_docs ADD CONSTRAINT vcycle_docs_unique UNIQUE (parent_type, parent_id, domain, phase, nav_page_id);

-- 4. Add domain to safety_analyses + update unique constraint
ALTER TABLE safety_analyses ADD COLUMN IF NOT EXISTS domain TEXT NOT NULL DEFAULT 'shared';
ALTER TABLE safety_analyses DROP CONSTRAINT IF EXISTS safety_analyses_parent_type_parent_id_analysis_type_key;
ALTER TABLE safety_analyses DROP CONSTRAINT IF EXISTS safety_analyses_unique;
ALTER TABLE safety_analyses ADD CONSTRAINT safety_analyses_unique UNIQUE (parent_type, parent_id, domain, analysis_type);

-- 5. nav_pages — custom sub-pages per phase
CREATE TABLE IF NOT EXISTS nav_pages (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_type TEXT NOT NULL,   -- 'item' or 'system'
  parent_id   UUID NOT NULL,
  domain      TEXT NOT NULL,   -- 'system' | 'sw' | 'hw' | 'mech' | 'item'
  phase       TEXT NOT NULL,   -- e.g. 'requirements'
  name        TEXT NOT NULL,
  sort_order  INT  NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE nav_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_nav_pages" ON nav_pages FOR ALL USING (auth.role() = 'authenticated');

-- 6. nav_phase_config — custom name / hidden state per phase per parent
CREATE TABLE IF NOT EXISTS nav_phase_config (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_type TEXT NOT NULL,
  parent_id   UUID NOT NULL,
  domain      TEXT NOT NULL,
  phase       TEXT NOT NULL,
  custom_name TEXT,
  is_hidden   BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (parent_type, parent_id, domain, phase)
);

ALTER TABLE nav_phase_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_nav_phase_config" ON nav_phase_config FOR ALL USING (auth.role() = 'authenticated');

-- 7. Foreign key: vcycle_docs.nav_page_id → nav_pages.id
ALTER TABLE vcycle_docs
  ADD CONSTRAINT fk_vcycle_nav_page
  FOREIGN KEY (nav_page_id) REFERENCES nav_pages(id) ON DELETE CASCADE;
