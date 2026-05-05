-- Extend findings to support line ranges (line_number = line_from, line_to = end of range)
ALTER TABLE review_findings ADD COLUMN IF NOT EXISTS line_to INTEGER;
