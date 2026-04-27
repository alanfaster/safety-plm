-- Add template_item_id to review_findings so findings can be linked
-- directly to a specific checklist criterion (nullable — open points have null).
ALTER TABLE review_findings
  ADD COLUMN IF NOT EXISTS template_item_id UUID REFERENCES review_template_items(id);
