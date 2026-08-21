-- OC-030..OC-034 — Physical production execution: part instances, operations, routing and module units.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS part_instances JSONB,
  ADD COLUMN IF NOT EXISTS module_units JSONB;
