-- Update verdict constraint to use ok/nok/partially_ok instead of go/no_go/conditional
ALTER TABLE review_artifact_verdicts
  DROP CONSTRAINT IF EXISTS review_artifact_verdicts_verdict_check;

ALTER TABLE review_artifact_verdicts
  ADD CONSTRAINT review_artifact_verdicts_verdict_check
    CHECK (verdict IN ('ok', 'nok', 'partially_ok'));

-- Migrate any existing rows with old values
UPDATE review_artifact_verdicts SET verdict = 'ok'           WHERE verdict = 'go';
UPDATE review_artifact_verdicts SET verdict = 'nok'          WHERE verdict = 'no_go';
UPDATE review_artifact_verdicts SET verdict = 'partially_ok' WHERE verdict = 'conditional';
