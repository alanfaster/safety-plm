-- Test Specifications table
-- Used for Unit Testing, Integration Testing, and System Testing phases

create table if not exists test_specs (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid references projects(id) on delete cascade,
  parent_type     text not null,          -- 'item' | 'system'
  parent_id       uuid not null,
  phase           text not null,          -- 'unit_testing' | 'integration_testing' | 'system_testing'
  nav_page_id     uuid,

  test_code       text,                   -- e.g. UT-ITEM-A2-001
  name            text not null default '',
  description     text,
  type            text default 'verification',   -- verification | validation
  level           text default 'system',         -- system | subsystem | component
  status          text default 'draft',          -- draft | review | approved | active | deprecated
  method          text default 'test',           -- test | analysis | inspection | demonstration
  environment     text default 'lab',            -- simulation | lab | field
  version         text default '1.0',

  -- Traceability
  linked_requirements jsonb default '[]',        -- array of req_code strings
  linked_functions    jsonb default '[]',
  linked_components   jsonb default '[]',
  linked_safety       jsonb default '[]',

  -- Test content
  preconditions       text,
  steps               jsonb default '[]',        -- [{id, action, input, expected_result}]
  expected_results    text,
  acceptance_criteria text,

  -- Execution
  result          text,                          -- pass | fail | blocked
  execution_date  timestamptz,
  executor        text,
  evidence        jsonb default '[]',            -- [{name, url, type}]
  notes           text,

  sort_order      integer default 0,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists test_specs_parent_idx on test_specs(parent_type, parent_id, phase);
create index if not exists test_specs_project_idx on test_specs(project_id);
