-- Add verification_type to requirements
-- Values: 'static' | 'dynamic' | 'na' | NULL (not yet set)

ALTER TABLE public.requirements
  ADD COLUMN IF NOT EXISTS verification_type TEXT
    CHECK (verification_type IN ('static', 'dynamic', 'na'));
