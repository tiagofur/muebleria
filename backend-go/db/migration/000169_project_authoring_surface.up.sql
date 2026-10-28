-- #1375: authoring surface per project ('sketchup' | 'proyectar').
-- Owner decision 2026-10-20: each project declares ONE authoring surface;
-- the other tool acts as a read-only viewer for the same canonical design.
-- Defaults to 'sketchup' for backwards compatibility.
ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS authoring_surface TEXT NOT NULL DEFAULT 'sketchup'
    CHECK (authoring_surface IN ('sketchup', 'proyectar'));
