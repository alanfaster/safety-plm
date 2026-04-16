-- FTA v2: add component and fta_code columns
ALTER TABLE public.fta_nodes
  ADD COLUMN IF NOT EXISTS component TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS fta_code  TEXT NOT NULL DEFAULT '';
