-- F036: project status produced (workflow draft → quoted → accepted → produced)

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check
    CHECK (status IN ('draft', 'quoted', 'accepted', 'produced'));
