-- #1599: a project created or synced from SketchUp with the library
-- developer mode ON carries a permanent provenance fact: "made in developer
-- mode, recommended for testing only". The server stamps it (never the
-- client), with the real first moment, only for callers allowed to use the
-- mode (#1598). It is a recommendation: nothing blocks quoting or
-- production. NULL = never marked. Once set it is never cleared or moved.

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS dev_mode_marked_at TIMESTAMPTZ NULL;

CREATE OR REPLACE FUNCTION project_dev_mode_mark_is_permanent()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.dev_mode_marked_at IS NOT NULL
       AND NEW.dev_mode_marked_at IS DISTINCT FROM OLD.dev_mode_marked_at THEN
        RAISE EXCEPTION 'project dev-mode mark is permanent'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_project_dev_mode_mark_permanent ON projects;
CREATE TRIGGER trg_project_dev_mode_mark_permanent
    BEFORE UPDATE OF dev_mode_marked_at ON projects
    FOR EACH ROW EXECUTE FUNCTION project_dev_mode_mark_is_permanent();
