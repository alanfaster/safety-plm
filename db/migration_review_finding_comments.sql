-- Finding comment threads: conversation between reviewer and author
-- Each finding has a thread of comments ordered by created_at.

CREATE TABLE review_finding_comments (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  finding_id UUID REFERENCES review_findings(id) ON DELETE CASCADE,
  author_id  UUID REFERENCES auth.users(id),
  comment    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE review_finding_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can manage finding comments"
  ON review_finding_comments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM review_findings rf
      JOIN review_sessions rs ON rs.id = rf.session_id
      JOIN project_members pm ON pm.project_id = rs.project_id
      WHERE rf.id = review_finding_comments.finding_id
        AND pm.user_id = auth.uid()
    )
  );
