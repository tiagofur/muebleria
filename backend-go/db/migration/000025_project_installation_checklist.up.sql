ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS installation_checklist JSONB;
