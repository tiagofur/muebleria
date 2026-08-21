-- OC-070..OC-074 — Installation job: visits, field issues, punch items and client closeout.
ALTER TABLE projects
  DROP COLUMN IF EXISTS installation;
