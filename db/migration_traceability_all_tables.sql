-- Add traceability JSONB column to arch_spec_items and test_specs
-- (requirements already has this column from migration_req_traceability.sql)
ALTER TABLE arch_spec_items ADD COLUMN IF NOT EXISTS traceability jsonb DEFAULT '{}'::jsonb;
ALTER TABLE test_specs       ADD COLUMN IF NOT EXISTS traceability jsonb DEFAULT '{}'::jsonb;
