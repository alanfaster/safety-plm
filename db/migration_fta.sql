-- FTA — Fault Tree Analysis nodes
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.fta_nodes (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_type    TEXT        NOT NULL,              -- 'item' | 'system'
  parent_id      UUID        NOT NULL,
  project_id     UUID,

  type           TEXT        NOT NULL DEFAULT 'basic',
  -- top_event | intermediate | gate_and | gate_or | gate_not | gate_inhibit
  -- basic | undeveloped | transfer

  label          TEXT        NOT NULL DEFAULT '',
  description    TEXT        NOT NULL DEFAULT '',

  x              FLOAT       NOT NULL DEFAULT 400,
  y              FLOAT       NOT NULL DEFAULT 300,

  parent_node_id UUID        REFERENCES public.fta_nodes(id) ON DELETE SET NULL,

  sort_order     INT         NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fta_nodes_parent ON public.fta_nodes(parent_type, parent_id);
CREATE INDEX IF NOT EXISTS fta_nodes_parent_node ON public.fta_nodes(parent_node_id);

ALTER TABLE public.fta_nodes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_fta_nodes" ON public.fta_nodes;
CREATE POLICY "allow_all_fta_nodes" ON public.fta_nodes FOR ALL USING (true) WITH CHECK (true);
