-- FTA v4b: change hazard_id FK from CASCADE to SET NULL
-- This ensures "Delete FC only" leaves FTA nodes intact at the DB level
ALTER TABLE public.fta_nodes
  DROP CONSTRAINT IF EXISTS fta_nodes_hazard_id_fkey;

ALTER TABLE public.fta_nodes
  ADD CONSTRAINT fta_nodes_hazard_id_fkey
    FOREIGN KEY (hazard_id) REFERENCES public.hazards(id)
    ON DELETE SET NULL;
