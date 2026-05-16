-- Sub-components: atomic parts inside a HW/SW/Mechanical block
-- Used for Component DFMEA (causes) and FMEDA (failure rate analysis)

CREATE TABLE IF NOT EXISTS sub_components (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  block_id    UUID NOT NULL REFERENCES arch_components(id) ON DELETE CASCADE,
  project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE sub_components ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='sub_comps_all' AND tablename='sub_components') THEN
    CREATE POLICY "sub_comps_all" ON sub_components FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Extend arch_function_fms to also support sub-component-level FMs
ALTER TABLE arch_function_fms
  ADD COLUMN IF NOT EXISTS sub_component_id UUID REFERENCES sub_components(id) ON DELETE CASCADE;

-- Update parent constraint to allow sub_component_id as a valid parent
ALTER TABLE arch_function_fms
  DROP CONSTRAINT IF EXISTS arch_fn_fms_has_parent,
  ADD CONSTRAINT arch_fn_fms_has_parent
    CHECK (function_id IS NOT NULL OR component_id IS NOT NULL OR sub_component_id IS NOT NULL);
