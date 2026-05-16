-- Failure modes per arch_function — used in System DFMEA cause selection
-- Each function of a component can have multiple defined failure modes

CREATE TABLE IF NOT EXISTS arch_function_fms (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  function_id UUID NOT NULL REFERENCES arch_functions(id) ON DELETE CASCADE,
  project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
  failure_mode TEXT NOT NULL,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE arch_function_fms ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='arch_fn_fms_all' AND tablename='arch_function_fms') THEN
    CREATE POLICY "arch_fn_fms_all" ON arch_function_fms FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Also extend sys_dfmea_items to store function + failure mode references
ALTER TABLE sys_dfmea_items
  ADD COLUMN IF NOT EXISTS cause_fn_id   UUID REFERENCES arch_functions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cause_fm_id   UUID REFERENCES arch_function_fms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cause_fn_name TEXT;
