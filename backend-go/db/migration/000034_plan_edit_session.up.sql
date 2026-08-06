-- Soft lock: who is editing Proyectar (kitchen plan).
ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS plan_edit_session JSONB;

COMMENT ON COLUMN projects.plan_edit_session IS
    'Soft lock {user_id, user_name, expires_at} for multi-user Proyectar collaboration';
