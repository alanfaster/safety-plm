-- Migration: Architecture Specification Items
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS arch_spec_items (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_code   TEXT        NOT NULL,
  title       TEXT        NOT NULL DEFAULT '',   -- displayed as "Description" in the UI
  type        TEXT        NOT NULL DEFAULT 'overview',
  uml_type    TEXT,                              -- component | state | usecase | class | null
  uml_data    JSONB,                             -- { nodes:[...], edges:[...] }
  status      TEXT        NOT NULL DEFAULT 'draft',
  sort_order  INT         NOT NULL DEFAULT 0,
  parent_type TEXT        NOT NULL,              -- 'item' | 'system'
  parent_id   UUID        NOT NULL,
  project_id  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Optional: index for fast lookups by parent
CREATE INDEX IF NOT EXISTS arch_spec_items_parent
  ON arch_spec_items (parent_type, parent_id);
