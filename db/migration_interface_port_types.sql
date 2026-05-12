-- Expand requirements type constraint to support internal vs external interface subtypes

-- 1. Normalize any out-of-range values to 'functional' before applying the new constraint
UPDATE requirements
  SET type = 'functional'
  WHERE type NOT IN ('functional','performance','safety','interface','interface_internal','interface_external','constraint');

-- 2. Drop old constraint and add the expanded one
ALTER TABLE requirements DROP CONSTRAINT IF EXISTS requirements_type_check;
ALTER TABLE requirements ADD CONSTRAINT requirements_type_check
  CHECK (type IN ('functional','performance','safety','interface','interface_internal','interface_external','constraint'));
