-- Function types and their HAZOP failure conditions
-- Replaces project_config.config.function_types JSON storage

create table if not exists function_types (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz default now()
);

create table if not exists function_type_fcs (
  id               uuid primary key default gen_random_uuid(),
  function_type_id uuid not null references function_types(id) on delete cascade,
  label            text not null,
  sort_order       integer not null default 0
);

-- Indexes
create index if not exists function_types_project_id_idx on function_types(project_id);
create index if not exists function_type_fcs_type_id_idx on function_type_fcs(function_type_id);

-- RLS
alter table function_types    enable row level security;
alter table function_type_fcs enable row level security;

create policy "Allow all for authenticated users" on function_types
  for all to authenticated using (true) with check (true);

create policy "Allow all for authenticated users" on function_type_fcs
  for all to authenticated using (true) with check (true);
