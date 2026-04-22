-- Test Specs v3: add traceability jsonb column for dynamic traceability fields

alter table test_specs
  add column if not exists traceability jsonb default '{}'::jsonb;

-- Backfill: migrate legacy linked_requirements into traceability
update test_specs
set traceability = jsonb_build_object('linked_requirements', linked_requirements)
where linked_requirements is not null
  and jsonb_array_length(linked_requirements) > 0
  and (traceability is null or traceability = '{}'::jsonb);
