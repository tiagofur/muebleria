CREATE TABLE IF NOT EXISTS production_activities (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    project_name    TEXT NOT NULL DEFAULT '',
    item_id         TEXT NOT NULL,
    module_code     TEXT NOT NULL DEFAULT '',
    module_name     TEXT NOT NULL DEFAULT '',
    sector          TEXT NOT NULL,
    type            TEXT NOT NULL, -- 'claim' | 'pause' | 'resume' | 'finish'
    operator_id     TEXT NOT NULL,
    operator_name   TEXT NOT NULL DEFAULT '',
    machine_id      TEXT NOT NULL DEFAULT '',
    machine_name    TEXT NOT NULL DEFAULT '',
    started_at      TIMESTAMP WITH TIME ZONE,
    finished_at     TIMESTAMP WITH TIME ZONE,
    duration_ms     BIGINT NOT NULL DEFAULT 0,
    pieces_count    INTEGER NOT NULL DEFAULT 0,
    notes           TEXT NOT NULL DEFAULT '',
    status_before   TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_production_activities_project ON production_activities(project_id);
CREATE INDEX IF NOT EXISTS idx_production_activities_sector ON production_activities(sector);
CREATE INDEX IF NOT EXISTS idx_production_activities_operator ON production_activities(operator_id);
CREATE INDEX IF NOT EXISTS idx_production_activities_created ON production_activities(created_at);

CREATE TABLE IF NOT EXISTS damage_reports (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    project_name    TEXT NOT NULL DEFAULT '',
    item_id         TEXT NOT NULL,
    sector          TEXT NOT NULL,
    damage_type     TEXT NOT NULL, -- 'corte' | 'rayon' | 'golpe' | 'agua' | 'otro'
    description     TEXT NOT NULL DEFAULT '',
    photo_url       TEXT NOT NULL DEFAULT '',
    reported_by     TEXT NOT NULL,
    reported_by_name TEXT NOT NULL DEFAULT '',
    reported_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    needs_replace   BOOLEAN NOT NULL DEFAULT false,
    resolved        BOOLEAN NOT NULL DEFAULT false,
    resolved_at     TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_damage_reports_project ON damage_reports(project_id);
CREATE INDEX IF NOT EXISTS idx_damage_reports_sector ON damage_reports(sector);
CREATE INDEX IF NOT EXISTS idx_damage_reports_reported_at ON damage_reports(reported_at);
