-- H09 / #104: commercial measure presets on modules + selection on project items.
-- structure_id already exists (000019). Structure.presets remain eng preview only.

CREATE TABLE IF NOT EXISTS module_presets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL DEFAULT '',
    width_mm INT NOT NULL CHECK (width_mm > 0),
    height_mm INT NOT NULL CHECK (height_mm > 0),
    depth_mm INT NOT NULL CHECK (depth_mm > 0)
);

CREATE INDEX IF NOT EXISTS idx_module_presets_module_id
    ON module_presets(module_id);

ALTER TABLE project_items
    ADD COLUMN IF NOT EXISTS measure_preset_id UUID;
