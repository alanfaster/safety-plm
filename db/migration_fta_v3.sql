-- FTA v3: probability, failure rate, MTTR, manual color
ALTER TABLE public.fta_nodes
  ADD COLUMN IF NOT EXISTS probability   FLOAT,
  ADD COLUMN IF NOT EXISTS failure_rate  FLOAT,
  ADD COLUMN IF NOT EXISTS mttr          FLOAT,
  ADD COLUMN IF NOT EXISTS color         TEXT NOT NULL DEFAULT '';
