-- Add review_role to review_session_reviewers
-- review_role = role within the review (author/moderator/reviewer/scribe)
-- role = project role code (SW-ARCH, HW-TST, etc.) — already exists
ALTER TABLE review_session_reviewers
  ADD COLUMN IF NOT EXISTS review_role TEXT DEFAULT 'reviewer'
    CHECK (review_role IN ('author','moderator','reviewer','scribe'));
