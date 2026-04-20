-- DFA: Dependent Failure Analysis table
-- Stores one analysis record per independence requirement (type='safety-independency')

CREATE TABLE IF NOT EXISTS public.dfa_analyses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id UUID REFERENCES public.requirements(id) ON DELETE SET NULL,
  req_code       TEXT,
  project_id     UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  parent_type    TEXT NOT NULL CHECK (parent_type IN ('item','system')),
  parent_id      UUID NOT NULL,
  data           JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dfa_analyses_req_id_idx    ON public.dfa_analyses(requirement_id);
CREATE INDEX IF NOT EXISTS dfa_analyses_parent_idx    ON public.dfa_analyses(parent_type, parent_id);
CREATE INDEX IF NOT EXISTS dfa_analyses_project_idx   ON public.dfa_analyses(project_id);

ALTER TABLE public.dfa_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON public.dfa_analyses
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Also update requirements: add type 'safety-independency' to the type column check if it exists
-- (no-op if requirements already uses free-text type)
