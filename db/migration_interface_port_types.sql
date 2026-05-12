-- Expand requirements type constraint to support internal vs external interface subtypes
ALTER TABLE requirements DROP CONSTRAINT IF EXISTS requirements_type_check;
ALTER TABLE requirements ADD CONSTRAINT requirements_type_check
  CHECK (type IN ('functional','performance','safety','interface','interface_internal','interface_external','constraint'));

-- Migrate existing interface requirements: connections that are internal keep 'interface',
-- new ones will use interface_internal or interface_external going forward.
-- (No data migration needed — existing records stay as 'interface' which is still valid)
