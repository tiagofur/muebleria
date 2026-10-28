-- #1375 down: drop project authoring surface declaration.
ALTER TABLE projects
    DROP COLUMN IF EXISTS authoring_surface;
