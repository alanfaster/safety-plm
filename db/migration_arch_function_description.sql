-- Add description to freestanding arch_functions (those without a function_ref_id)
ALTER TABLE arch_functions
  ADD COLUMN IF NOT EXISTS description TEXT;
