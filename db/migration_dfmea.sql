-- Migration: DFMEA Items (VDA DFMEA 2019)
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)

CREATE TABLE IF NOT EXISTS public.dfmea_items (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  dfmea_code          TEXT        NOT NULL,
  parent_type         TEXT        NOT NULL,              -- 'item' | 'system'
  parent_id           UUID        NOT NULL,
  project_id          UUID,

  -- Structure / Function (links to architecture)
  component_id        UUID,                              -- FK → arch_components (nullable)
  component_name      TEXT        NOT NULL DEFAULT '',

  function_name       TEXT        NOT NULL DEFAULT '',

  -- Failure chain
  failure_mode        TEXT        NOT NULL DEFAULT '',   -- How the function fails
  effect_higher       TEXT        NOT NULL DEFAULT '',   -- Failure Effect — Higher Level
  effect_local        TEXT        NOT NULL DEFAULT '',   -- Failure Effect — Local
  failure_cause       TEXT        NOT NULL DEFAULT '',   -- Failure Cause (lower level)

  -- Risk assessment
  severity            INT         NOT NULL DEFAULT 5 CHECK (severity BETWEEN 1 AND 10),
  prevention_controls TEXT        NOT NULL DEFAULT '',
  occurrence          INT         NOT NULL DEFAULT 5 CHECK (occurrence BETWEEN 1 AND 10),
  detection_controls  TEXT        NOT NULL DEFAULT '',
  detection           INT         NOT NULL DEFAULT 5 CHECK (detection BETWEEN 1 AND 10),
  -- ap is computed client-side (H/M/L/N per VDA 2019)

  -- Actions
  actions             TEXT        NOT NULL DEFAULT '',
  responsible         TEXT        NOT NULL DEFAULT '',
  target_date         TEXT        NOT NULL DEFAULT '',
  action_status       TEXT        NOT NULL DEFAULT 'open',  -- open | in_progress | closed

  -- Traceability
  hazard_id           UUID,                              -- FK → hazards (from FHA sync)

  sort_order          INT         NOT NULL DEFAULT 0,
  status              TEXT        NOT NULL DEFAULT 'draft',  -- draft | review | approved
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookups by parent
CREATE INDEX IF NOT EXISTS dfmea_items_parent
  ON public.dfmea_items (parent_type, parent_id);

-- Enable RLS (required in Supabase)
ALTER TABLE public.dfmea_items ENABLE ROW LEVEL SECURITY;

-- Allow full access (same pattern as other tables)
DROP POLICY IF EXISTS "allow_all_dfmea_items" ON public.dfmea_items;
CREATE POLICY "allow_all_dfmea_items"
  ON public.dfmea_items FOR ALL
  USING (true)
  WITH CHECK (true);
