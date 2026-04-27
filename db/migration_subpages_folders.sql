-- Sub-subpages: parent_page_id for nesting nav_pages
ALTER TABLE public.nav_pages
  ADD COLUMN IF NOT EXISTS parent_page_id UUID REFERENCES public.nav_pages(id) ON DELETE CASCADE;

-- Folder nodes in sidebar (is_folder = true → not navigable, just a container)
ALTER TABLE public.nav_pages
  ADD COLUMN IF NOT EXISTS is_folder BOOLEAN NOT NULL DEFAULT FALSE;

-- Requirements: add 'title' and 'info' row types
ALTER TABLE public.requirements
  DROP CONSTRAINT IF EXISTS requirements_type_check;

ALTER TABLE public.requirements
  ADD CONSTRAINT requirements_type_check
    CHECK (type IN ('functional','performance','safety','safety-independency','interface','constraint','title','info'));

-- Level for title rows (1=H2, 2=H3, 3=H4)
ALTER TABLE public.requirements
  ADD COLUMN IF NOT EXISTS level INT DEFAULT 1;
