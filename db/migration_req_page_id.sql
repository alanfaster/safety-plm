-- Scope title/info structural rows to a specific nav_pages subpage
ALTER TABLE public.requirements
  ADD COLUMN IF NOT EXISTS page_id UUID REFERENCES public.nav_pages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_requirements_page_id ON public.requirements(page_id);
