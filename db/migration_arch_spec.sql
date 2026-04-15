-- Migration: Architecture Specification Items
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)

CREATE TABLE IF NOT EXISTS public.arch_spec_items (
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

-- Add sort_order if the table was created before this column was introduced
ALTER TABLE public.arch_spec_items
  ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;

-- Index for fast lookups by parent
CREATE INDEX IF NOT EXISTS arch_spec_items_parent
  ON public.arch_spec_items (parent_type, parent_id);

-- Enable RLS (required in Supabase)
ALTER TABLE public.arch_spec_items ENABLE ROW LEVEL SECURITY;

-- Allow full access (same pattern as other tables in this project)
DROP POLICY IF EXISTS "allow_all_arch_spec_items" ON public.arch_spec_items;
CREATE POLICY "allow_all_arch_spec_items"
  ON public.arch_spec_items FOR ALL
  USING (true)
  WITH CHECK (true);
