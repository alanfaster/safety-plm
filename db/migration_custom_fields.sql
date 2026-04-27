-- Custom column values for requirements and arch_spec_items
ALTER TABLE public.requirements
  ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}';

ALTER TABLE public.arch_spec_items
  ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}';
