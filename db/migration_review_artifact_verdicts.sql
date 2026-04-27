-- Review Artifact Verdicts
-- One GO/NO-GO/Conditional verdict + closing comment per reviewer per artifact snapshot.

CREATE TABLE review_artifact_verdicts (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id      UUID REFERENCES review_sessions(id) ON DELETE CASCADE,
  snapshot_id     UUID REFERENCES review_artifact_snapshots(id) ON DELETE CASCADE,
  reviewer_id     UUID REFERENCES auth.users(id),
  verdict         TEXT CHECK (verdict IN ('go','conditional','no_go')),
  verdict_comment TEXT,
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (snapshot_id, reviewer_id)
);

ALTER TABLE review_artifact_verdicts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can manage artifact verdicts"
  ON review_artifact_verdicts FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM review_sessions rs
      JOIN project_members pm ON pm.project_id = rs.project_id
      WHERE rs.id = review_artifact_verdicts.session_id
        AND pm.user_id = auth.uid()
    )
  );
