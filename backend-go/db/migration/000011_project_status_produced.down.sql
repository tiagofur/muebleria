-- Reverse F036 produced status (rows with produced must be rewritten first)

UPDATE projects SET status = 'accepted' WHERE status = 'produced';

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check
    CHECK (status IN ('draft', 'quoted', 'accepted'));
