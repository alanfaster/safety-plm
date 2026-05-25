-- NEW FMEA Beta v2 — reuses arch_functions/arch_components as the structural model
-- Only adds the functional dependency layer on top

-- Canvas positions + cut mechanisms per function (extends arch_functions for FMEA)
CREATE TABLE IF NOT EXISTS fmea_node_config (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fn_id               UUID NOT NULL REFERENCES arch_functions(id) ON DELETE CASCADE,
  project_id          UUID REFERENCES projects(id) ON DELETE CASCADE,
  parent_type         TEXT NOT NULL,
  parent_id           UUID NOT NULL,
  x                   NUMERIC DEFAULT 0,
  y                   NUMERIC DEFAULT 0,
  has_redundancy      BOOLEAN DEFAULT false,
  redundancy_desc     TEXT,
  has_safe_state      BOOLEAN DEFAULT false,
  safe_state_desc     TEXT,
  fault_tolerance     TEXT DEFAULT 'none' CHECK (fault_tolerance IN ('none','partial','full')),
  UNIQUE (fn_id, parent_type, parent_id)
);

-- Functional dependency edges between functions (cross-component)
CREATE TABLE IF NOT EXISTS fmea_function_edges (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id           UUID REFERENCES projects(id) ON DELETE CASCADE,
  parent_type          TEXT NOT NULL,
  parent_id            UUID NOT NULL,
  source_fn_id         UUID NOT NULL REFERENCES arch_functions(id) ON DELETE CASCADE,
  target_fn_id         UUID NOT NULL REFERENCES arch_functions(id) ON DELETE CASCADE,
  edge_type            TEXT DEFAULT 'depends_on' CHECK (edge_type IN (
                         'depends_on','controls','monitors','powers',
                         'communicates_with','triggers')),
  label                TEXT,
  diagnostic_coverage  INTEGER DEFAULT 0 CHECK (diagnostic_coverage BETWEEN 0 AND 100),
  diagnostic_mechanism TEXT,
  created_at           TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source_fn_id, target_fn_id, parent_type, parent_id)
);

-- Semantic propagation rules (auto-inferred, user-editable)
CREATE TABLE IF NOT EXISTS fmea_propagation_rules (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  edge_id          UUID NOT NULL REFERENCES fmea_function_edges(id) ON DELETE CASCADE,
  source_fm_id     UUID NOT NULL REFERENCES arch_function_fms(id) ON DELETE CASCADE,
  effect_at_target TEXT NOT NULL,
  severity         INTEGER DEFAULT 5 CHECK (severity BETWEEN 1 AND 10),
  is_inferred      BOOLEAN DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE fmea_node_config        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmea_function_edges     ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmea_propagation_rules  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='fmea_node_config_all'       AND tablename='fmea_node_config')       THEN CREATE POLICY "fmea_node_config_all"       ON fmea_node_config       FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='fmea_function_edges_all'    AND tablename='fmea_function_edges')    THEN CREATE POLICY "fmea_function_edges_all"    ON fmea_function_edges    FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='fmea_prop_rules_all'        AND tablename='fmea_propagation_rules') THEN CREATE POLICY "fmea_prop_rules_all"        ON fmea_propagation_rules FOR ALL USING (true) WITH CHECK (true); END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fmea_nc_fn        ON fmea_node_config(fn_id);
CREATE INDEX IF NOT EXISTS idx_fmea_nc_parent    ON fmea_node_config(parent_type, parent_id);
CREATE INDEX IF NOT EXISTS idx_fmea_fe_src       ON fmea_function_edges(source_fn_id);
CREATE INDEX IF NOT EXISTS idx_fmea_fe_tgt       ON fmea_function_edges(target_fn_id);
CREATE INDEX IF NOT EXISTS idx_fmea_fe_parent    ON fmea_function_edges(parent_type, parent_id);
CREATE INDEX IF NOT EXISTS idx_fmea_pr_edge      ON fmea_propagation_rules(edge_id);
