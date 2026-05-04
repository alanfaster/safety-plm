-- Wire sw_units into the artifact versioning + history system.
-- The increment_artifact_version() function (from migration_artifact_version_history.sql)
-- already inserts OLD row into artifact_version_history and increments version on UPDATE.

DROP TRIGGER IF EXISTS trg_version ON sw_units;
CREATE TRIGGER trg_version
  BEFORE UPDATE ON sw_units
  FOR EACH ROW EXECUTE FUNCTION increment_artifact_version();
