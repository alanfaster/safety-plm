-- migration_005_architecture.sql
-- Architecture canvas: components, functions, connections

CREATE TABLE IF NOT EXISTS arch_components (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_type    TEXT NOT NULL,                                    -- 'item' | 'system'
  parent_id      UUID NOT NULL,
  project_id     UUID REFERENCES projects(id) ON DELETE CASCADE,
  name           TEXT NOT NULL DEFAULT 'Component',
  comp_type      TEXT NOT NULL DEFAULT 'HW',                       -- 'HW' | 'SW' | 'Mechanical'
  x              NUMERIC NOT NULL DEFAULT 100,
  y              NUMERIC NOT NULL DEFAULT 100,
  width          NUMERIC NOT NULL DEFAULT 180,
  height         NUMERIC NOT NULL DEFAULT 120,
  is_safety_critical BOOLEAN NOT NULL DEFAULT false,
  system_group   TEXT,                                             -- optional group label (cross-system external ifaces)
  data           JSONB NOT NULL DEFAULT '{}',
  sort_order     INT  NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arch_functions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id       UUID NOT NULL REFERENCES arch_components(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  is_safety_related  BOOLEAN NOT NULL DEFAULT false,
  function_ref_id    UUID REFERENCES functions(id) ON DELETE SET NULL, -- future link
  sort_order         INT NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arch_connections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_type    TEXT NOT NULL,
  parent_id      UUID NOT NULL,
  project_id     UUID REFERENCES projects(id) ON DELETE CASCADE,
  source_id      UUID NOT NULL REFERENCES arch_components(id) ON DELETE CASCADE,
  target_id      UUID NOT NULL REFERENCES arch_components(id) ON DELETE CASCADE,
  source_port    TEXT NOT NULL DEFAULT 'right',   -- top|right|bottom|left
  target_port    TEXT NOT NULL DEFAULT 'left',
  interface_type TEXT NOT NULL DEFAULT 'Data',    -- Electrical|Data|Mechanical|Thermal
  direction      TEXT NOT NULL DEFAULT 'bidirectional', -- A_to_B|B_to_A|bidirectional
  name           TEXT,
  requirement    TEXT,                            -- auto-generated, editable
  is_external    BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_arch_comp_parent ON arch_components(parent_type, parent_id);
CREATE INDEX IF NOT EXISTS idx_arch_fun_comp    ON arch_functions(component_id);
CREATE INDEX IF NOT EXISTS idx_arch_conn_parent ON arch_connections(parent_type, parent_id);
CREATE INDEX IF NOT EXISTS idx_arch_conn_src    ON arch_connections(source_id);
CREATE INDEX IF NOT EXISTS idx_arch_conn_tgt    ON arch_connections(target_id);
