-- Test Specs v2: method becomes jsonb array, add new fields

-- Step 1: drop the default so Postgres can change the type freely
alter table test_specs alter column method drop default;

-- Step 2: convert text → jsonb (wrap existing value in an array)
alter table test_specs
  alter column method type jsonb
    using case
      when method is null or method = '' then '[]'::jsonb
      else to_jsonb(array[method])
    end;

-- Step 3: set the new default
alter table test_specs alter column method set default '[]'::jsonb;

-- Step 4: backfill any remaining nulls
update test_specs set method = '[]' where method is null;

-- Step 5: add new columns
alter table test_specs
  add column if not exists implementation_ticket text,
  add column if not exists last_modified_by      text;
