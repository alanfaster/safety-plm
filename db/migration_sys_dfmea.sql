-- System DFMEA (VDA 2019) — System-level failure analysis
-- Upper: Item  |  Focus: System (arch_components Group)  |  Lower: Component (HW/SW/Mechanical)

CREATE TABLE IF NOT EXISTS sys_dfmea_items (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id       UUID REFERENCES projects(id) ON DELETE CASCADE,
  item_id          UUID,                          -- parent item
  row_type         TEXT NOT NULL CHECK (row_type IN ('fm','effect','cause')),
  parent_row_id    UUID REFERENCES sys_dfmea_items(id) ON DELETE CASCADE,
  dfmea_code       TEXT,
  sort_order       INTEGER DEFAULT 0,

  -- System (focus element)
  arch_comp_id     UUID REFERENCES arch_components(id) ON DELETE SET NULL,
  system_name      TEXT,                          -- denormalized for display

  -- Function of the system
  function_name    TEXT,
  function_ref_id  UUID,                          -- → arch_functions.id

  -- Failure Mode (row_type='fm')
  failure_mode     TEXT,

  -- Effect (row_type='effect') — propagates UP to Item level
  effect_higher    TEXT,                          -- effect at item level
  effect_local     TEXT,                          -- local effect at system level

  -- Cause (row_type='cause') — comes from Component level
  failure_cause    TEXT,
  cause_comp_id    UUID REFERENCES arch_components(id) ON DELETE SET NULL,
  cause_comp_name  TEXT,                          -- denormalized

  -- Risk ratings
  severity         INTEGER DEFAULT 5 CHECK (severity BETWEEN 1 AND 10),
  occurrence       INTEGER DEFAULT 5 CHECK (occurrence BETWEEN 1 AND 10),
  detection        INTEGER DEFAULT 5 CHECK (detection BETWEEN 1 AND 10),
  prevention_controls TEXT,
  detection_controls  TEXT,

  -- Optimization
  actions          TEXT,
  responsible      TEXT,
  target_date      TEXT,
  action_status    TEXT DEFAULT 'open' CHECK (action_status IN ('open','in_progress','closed')),
  status           TEXT DEFAULT 'draft' CHECK (status IN ('draft','review','approved')),

  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE sys_dfmea_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sys_dfmea_all" ON sys_dfmea_items FOR ALL USING (true) WITH CHECK (true);
