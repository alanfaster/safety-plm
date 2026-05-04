-- Add traceability JSONB to sw_units (links to other V-model nodes)
ALTER TABLE sw_units ADD COLUMN IF NOT EXISTS traceability JSONB DEFAULT '{}'::jsonb;
