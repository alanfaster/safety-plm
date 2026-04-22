-- Migration: link arch_spec_items to arch_components + add system_name field
-- Run in Supabase SQL Editor

ALTER TABLE public.arch_spec_items
  ADD COLUMN IF NOT EXISTS component_ref_id UUID,
  ADD COLUMN IF NOT EXISTS system_name      TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS custom_fields    JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS arch_spec_items_component_ref
  ON public.arch_spec_items (component_ref_id)
  WHERE component_ref_id IS NOT NULL;
