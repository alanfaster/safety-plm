-- NEW FMEA Beta — functional dependency graph model
-- Nodes = functional elements, Edges = dependency/propagation paths
-- Independent from arch_components (different abstraction level)

CREATE TABLE IF NOT EXISTS fmea_nodes (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id         UUID REFERENCES projects(id) ON DELETE CASCADE,
  parent_type        TEXT NOT NULL,  -- 'item' | 'system'
  parent_id          UUID NOT NULL,
  name               TEXT NOT NULL,
  description        TEXT,
  node_type          TEXT DEFAULT 'function' CHECK (node_type IN (
                       'function','sensor','actuator','controller',
                       'bus','power','safety_monitor','external')),
  x                  NUMERIC DEFAULT 100,
  y                  NUMERIC DEFAULT 100,
  is_safety_critical BOOLEAN DEFAULT false,
  arch_component_id  UUID REFERENCES arch_components(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fmea_edges (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
  source_id   UUID NOT NULL REFERENCES fmea_nodes(id) ON DELETE CASCADE,
  target_id   UUID NOT NULL REFERENCES fmea_nodes(id) ON DELETE CASCADE,
  edge_type   TEXT DEFAULT 'depends_on' CHECK (edge_type IN (
                'depends_on','controls','monitors','powers',
                'communicates_with','triggers')),
  label       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fmea_failure_modes (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  node_id      UUID NOT NULL REFERENCES fmea_nodes(id) ON DELETE CASCADE,
  project_id   UUID REFERENCES projects(id) ON DELETE CASCADE,
  failure_mode TEXT NOT NULL,
  local_effect TEXT,
  sort_order   INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Semantic propagation rules: "if FM X at source node, effect at target node via edge E is Y"
CREATE TABLE IF NOT EXISTS fmea_propagation_rules (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  edge_id          UUID NOT NULL REFERENCES fmea_edges(id) ON DELETE CASCADE,
  source_fm_id     UUID NOT NULL REFERENCES fmea_failure_modes(id) ON DELETE CASCADE,
  effect_at_target TEXT NOT NULL,
  severity         INTEGER DEFAULT 5 CHECK (severity BETWEEN 1 AND 10),
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- Saved analysis scenarios (injection + propagation snapshot)
CREATE TABLE IF NOT EXISTS fmea_scenarios (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id       UUID REFERENCES projects(id) ON DELETE CASCADE,
  parent_type      TEXT NOT NULL,
  parent_id        UUID NOT NULL,
  name             TEXT NOT NULL,
  injected_node_id UUID REFERENCES fmea_nodes(id) ON DELETE SET NULL,
  injected_fm_id   UUID REFERENCES fmea_failure_modes(id) ON DELETE SET NULL,
  result_json      JSONB,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE fmea_nodes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmea_edges             ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmea_failure_modes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmea_propagation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmea_scenarios         ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='fmea_nodes_all'             AND tablename='fmea_nodes')             THEN CREATE POLICY "fmea_nodes_all"             ON fmea_nodes             FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='fmea_edges_all'             AND tablename='fmea_edges')             THEN CREATE POLICY "fmea_edges_all"             ON fmea_edges             FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='fmea_failure_modes_all'     AND tablename='fmea_failure_modes')     THEN CREATE POLICY "fmea_failure_modes_all"     ON fmea_failure_modes     FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='fmea_propagation_rules_all' AND tablename='fmea_propagation_rules') THEN CREATE POLICY "fmea_propagation_rules_all" ON fmea_propagation_rules FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='fmea_scenarios_all'         AND tablename='fmea_scenarios')         THEN CREATE POLICY "fmea_scenarios_all"         ON fmea_scenarios         FOR ALL USING (true) WITH CHECK (true); END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fmea_nodes_parent ON fmea_nodes(parent_type, parent_id);
CREATE INDEX IF NOT EXISTS idx_fmea_edges_src    ON fmea_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_fmea_edges_tgt    ON fmea_edges(target_id);
CREATE INDEX IF NOT EXISTS idx_fmea_fms_node     ON fmea_failure_modes(node_id);
