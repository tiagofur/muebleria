-- OC-010 & OC-011: Project Events append-only log and Commercial Status column

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS commercial_status VARCHAR(32);

CREATE INDEX IF NOT EXISTS idx_projects_commercial_status
  ON projects(commercial_status);

CREATE TABLE IF NOT EXISTS project_events (
    id TEXT PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    at TIMESTAMPTZ NOT NULL,
    by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    source TEXT NOT NULL DEFAULT 'web',
    note TEXT,
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_project_events_project
    ON project_events(project_id, at ASC);

CREATE INDEX IF NOT EXISTS idx_project_events_type
    ON project_events(type);
