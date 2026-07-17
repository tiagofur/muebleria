ALTER TABLE project_items DROP COLUMN IF EXISTS measure_preset_id;
DROP TABLE IF EXISTS module_presets CASCADE;
ALTER TABLE modules DROP COLUMN IF EXISTS structure_id;
