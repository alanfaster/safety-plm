A-- Add sort_order to requirements for manual row ordering
ALTER TABLE public.requirements
  ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;

-- Backfill existing rows with their creation order
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY parent_id ORDER BY created_at) - 1 AS rn
  FROM public.requirements
)
UPDATE public.requirements r SET sort_order = ranked.rn
FROM ranked WHERE ranked.id = r.id;
