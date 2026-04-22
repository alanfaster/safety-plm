-- Domain scoping: add domain column to arch_spec_items and test_specs,
-- then normalise all existing records so each domain within a system is independent.

-- 1. Add domain column where missing
ALTER TABLE arch_spec_items ADD COLUMN IF NOT EXISTS domain text;
ALTER TABLE test_specs      ADD COLUMN IF NOT EXISTS domain text;

-- 2. Normalise existing records
--    system-level rows → domain='system'  (they were all lumped as 'SYS' or NULL)
--    item-level rows   → domain='item'

UPDATE requirements
SET domain = 'system'
WHERE parent_type = 'system' AND (domain = 'SYS' OR domain IS NULL);

UPDATE requirements
SET domain = 'item'
WHERE parent_type = 'item' AND (domain = 'ITEM' OR domain IS NULL);

UPDATE arch_spec_items
SET domain = 'system'
WHERE parent_type = 'system' AND (domain = 'SYS' OR domain IS NULL);

UPDATE arch_spec_items
SET domain = 'item'
WHERE parent_type = 'item' AND (domain = 'ITEM' OR domain IS NULL);

UPDATE test_specs
SET domain = 'system'
WHERE parent_type = 'system' AND (domain = 'SYS' OR domain IS NULL);

UPDATE test_specs
SET domain = 'item'
WHERE parent_type = 'item' AND (domain = 'ITEM' OR domain IS NULL);
