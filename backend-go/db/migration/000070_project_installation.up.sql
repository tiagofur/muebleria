-- OC-070..OC-074 — Installation job: visits, field issues, punch items and client closeout.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS installation JSONB;
