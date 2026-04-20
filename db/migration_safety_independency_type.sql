-- Add 'safety-independency' to requirements.type CHECK constraint
-- PostgreSQL requires dropping and re-adding the constraint

ALTER TABLE public.requirements
  DROP CONSTRAINT IF EXISTS requirements_type_check;

ALTER TABLE public.requirements
  ADD CONSTRAINT requirements_type_check
    CHECK (type IN ('functional', 'performance', 'safety', 'safety-independency', 'interface', 'constraint'));
