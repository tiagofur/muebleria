-- F092 — shop-floor transition log: one immutable row per floor status
-- change (who / when / how). Additive; project_items.floor_status keeps
-- being the live state, this table is the history behind it.
CREATE TABLE IF NOT EXISTS project_item_floor_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    from_status TEXT NOT NULL DEFAULT 'pending',
    to_status TEXT NOT NULL,
    at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    by_name TEXT,
    source TEXT NOT NULL DEFAULT 'api',
    note TEXT
);

CREATE INDEX IF NOT EXISTS idx_floor_events_project
    ON project_item_floor_events(project_id, at);
