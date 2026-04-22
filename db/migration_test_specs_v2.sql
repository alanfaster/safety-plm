-- Test Specs v2: method becomes jsonb array, add new fields

alter table test_specs
  alter column method type jsonb using to_jsonb(array[method]),
  add column if not exists implementation_ticket text,
  add column if not exists last_modified_by      text;

-- Backfill: wrap existing text values into arrays (already done by alter above)
-- If method was null, set to empty array
update test_specs set method = '[]' where method is null;
