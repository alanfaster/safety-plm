-- Add traceability JSONB column to requirements
-- Stores links to other V-model nodes: { [nodeId]: ['REQ-001', 'SPEC-002', ...] }
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS traceability jsonb DEFAULT '{}'::jsonb;
