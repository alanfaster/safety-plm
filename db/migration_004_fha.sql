-- migration_004_fha.sql
-- FHA support: function_type on functions, analysis_type + function_id on hazards

-- Add function type to functions table
ALTER TABLE functions ADD COLUMN IF NOT EXISTS function_type TEXT;

-- Extend hazards table to support both PHA and FHA entries
ALTER TABLE hazards ADD COLUMN IF NOT EXISTS analysis_type TEXT NOT NULL DEFAULT 'PHA';
ALTER TABLE hazards ADD COLUMN IF NOT EXISTS function_id   UUID REFERENCES functions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hazards_fun  ON hazards(function_id);
CREATE INDEX IF NOT EXISTS idx_hazards_type ON hazards(analysis_type, parent_type, parent_id);
