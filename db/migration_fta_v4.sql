-- FTA v4: link FTA trees to specific FHA failure conditions
ALTER TABLE public.fta_nodes
  ADD COLUMN IF NOT EXISTS hazard_id UUID REFERENCES public.hazards(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_fta_nodes_hazard ON public.fta_nodes(hazard_id);
