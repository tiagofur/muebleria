-- F050 / #100: Presets de medida y estirado de estructuras

CREATE TABLE IF NOT EXISTS structure_presets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    structure_id UUID NOT NULL REFERENCES structures(id) ON DELETE CASCADE,
    name VARCHAR(255),
    width_mm INT NOT NULL CHECK (width_mm > 0),
    height_mm INT NOT NULL CHECK (height_mm > 0),
    depth_mm INT NOT NULL CHECK (depth_mm > 0)
);

CREATE INDEX IF NOT EXISTS idx_structure_presets_structure_id
    ON structure_presets(structure_id);

ALTER TABLE structure_board_parts ADD COLUMN IF NOT EXISTS length_formula VARCHAR(100);
ALTER TABLE structure_board_parts ADD COLUMN IF NOT EXISTS width_formula VARCHAR(100);
