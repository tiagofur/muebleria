ALTER TABLE projects
  DROP COLUMN IF EXISTS part_instances,
  DROP COLUMN IF EXISTS module_units;
