-- RLS policies for test_specs table
-- Run this in Supabase SQL Editor after migration_test_specs.sql

-- Allow all operations for authenticated users (same pattern as other tables in this project)
create policy "Allow all for authenticated users"
  on test_specs
  for all
  to authenticated
  using (true)
  with check (true);
