-- Domain scoping for system-level records
-- Previously all system-level rows used domain='SYS' regardless of which
-- domain (sw/hw/mech/system) they belonged to, causing all domains within a
-- system to share the same data.
--
-- This migration normalises existing system-level records to domain='system'
-- (the system-design domain). New records will carry the actual domain key.

UPDATE requirements
SET domain = 'system'
WHERE parent_type = 'system' AND (domain = 'SYS' OR domain IS NULL);

UPDATE arch_spec_items
SET domain = 'system'
WHERE parent_type = 'system' AND (domain = 'SYS' OR domain IS NULL);

UPDATE test_specs
SET domain = 'system'
WHERE parent_type = 'system' AND (domain = 'SYS' OR domain IS NULL);

-- Item-level records stay as-is (domain='ITEM' is still valid, but normalise
-- to 'item' for consistency)
UPDATE requirements    SET domain = 'item' WHERE parent_type = 'item' AND (domain = 'ITEM' OR domain IS NULL);
UPDATE arch_spec_items SET domain = 'item' WHERE parent_type = 'item' AND (domain = 'ITEM' OR domain IS NULL);
UPDATE test_specs      SET domain = 'item' WHERE parent_type = 'item' AND (domain = 'ITEM' OR domain IS NULL);
