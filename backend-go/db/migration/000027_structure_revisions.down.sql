-- Reverse of 000027 (additive; safe to re-run).
DROP TABLE IF EXISTS structure_revisions;
ALTER TABLE structures DROP COLUMN IF EXISTS revision;
ALTER TABLE project_items DROP COLUMN IF EXISTS structure_revision_pin;
