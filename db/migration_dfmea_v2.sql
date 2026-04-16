-- DFMEA v2: multi-effect / multi-cause hierarchy
-- Run in Supabase SQL Editor

-- Add row_type and parent_row_id to support FM → Effect → Cause tree
ALTER TABLE public.dfmea_items
  ADD COLUMN IF NOT EXISTS row_type TEXT NOT NULL DEFAULT 'fm',
  ADD COLUMN IF NOT EXISTS parent_row_id UUID REFERENCES public.dfmea_items(id) ON DELETE CASCADE;

-- Index for fast child lookups
CREATE INDEX IF NOT EXISTS dfmea_items_parent_row_idx ON public.dfmea_items(parent_row_id);
CREATE INDEX IF NOT EXISTS dfmea_items_row_type_idx   ON public.dfmea_items(row_type);
