-- Wiki pages support: page_type + wiki_content on nav_pages
ALTER TABLE public.nav_pages
  ADD COLUMN IF NOT EXISTS page_type TEXT NOT NULL DEFAULT 'standard';

ALTER TABLE public.nav_pages
  ADD COLUMN IF NOT EXISTS wiki_content TEXT;
