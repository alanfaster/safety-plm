-- Finding resolved flow for SW unit code review
-- Adds 'resolved' status (author marks as fixed) distinct from 'closed' (reviewer confirms)
-- Also tracks which SW unit version the finding was on and which version contains the fix

-- 1. Extend status constraint
ALTER TABLE review_findings DROP CONSTRAINT IF EXISTS review_findings_status_check;
ALTER TABLE review_findings ADD CONSTRAINT review_findings_status_check
  CHECK (status IN ('open','resolved','closed','rejected','duplicate'));

-- 2. Version tracking columns
ALTER TABLE review_findings
  ADD COLUMN IF NOT EXISTS sw_unit_version_at_finding INTEGER,
  ADD COLUMN IF NOT EXISTS resolved_at_version         INTEGER,
  ADD COLUMN IF NOT EXISTS resolved_by                 UUID REFERENCES auth.users(id);
