CREATE TABLE IF NOT EXISTS review_artifact_comments (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id  UUID REFERENCES review_sessions(id) ON DELETE CASCADE,
  snapshot_id UUID REFERENCES review_artifact_snapshots(id) ON DELETE CASCADE,
  author_id   UUID REFERENCES auth.users(id),
  comment     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rac_snapshot ON review_artifact_comments (snapshot_id, created_at);

ALTER TABLE review_artifact_comments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'review_artifact_comments' AND policyname = 'auth_all'
  ) THEN
    CREATE POLICY auth_all ON review_artifact_comments
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
