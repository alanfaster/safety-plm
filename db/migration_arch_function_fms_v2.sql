-- Extend arch_function_fms to support both function-level FMs (VDA DFMEA)
-- and direct component-level FMs (FMEDA / discrete HW components).
--
-- function_id IS NOT NULL  → FM tied to a function (VDA 2019 compliant)
-- function_id IS NULL      → FM tied directly to a component (FMEDA style)

ALTER TABLE arch_function_fms
  ALTER COLUMN function_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS component_id UUID REFERENCES arch_components(id) ON DELETE CASCADE;

-- Ensure at least one of function_id / component_id is always set
ALTER TABLE arch_function_fms
  DROP CONSTRAINT IF EXISTS arch_fn_fms_has_parent,
  ADD CONSTRAINT arch_fn_fms_has_parent
    CHECK (function_id IS NOT NULL OR component_id IS NOT NULL);
