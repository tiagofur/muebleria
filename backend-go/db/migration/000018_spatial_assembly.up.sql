-- S1 spatial assembly metadata (optional; BOM unchanged without these fields)

ALTER TABLE board_parts
    ADD COLUMN IF NOT EXISTS face VARCHAR(8),
    ADD COLUMN IF NOT EXISTS placement VARCHAR(32),
    ADD COLUMN IF NOT EXISTS origin_x_formula VARCHAR(100),
    ADD COLUMN IF NOT EXISTS origin_y_formula VARCHAR(100),
    ADD COLUMN IF NOT EXISTS origin_z_formula VARCHAR(100),
    ADD COLUMN IF NOT EXISTS design_thickness_mm INT;

ALTER TABLE structure_board_parts
    ADD COLUMN IF NOT EXISTS face VARCHAR(8),
    ADD COLUMN IF NOT EXISTS placement VARCHAR(32),
    ADD COLUMN IF NOT EXISTS origin_x_formula VARCHAR(100),
    ADD COLUMN IF NOT EXISTS origin_y_formula VARCHAR(100),
    ADD COLUMN IF NOT EXISTS origin_z_formula VARCHAR(100),
    ADD COLUMN IF NOT EXISTS design_thickness_mm INT;

ALTER TABLE component_board_parts
    ADD COLUMN IF NOT EXISTS face VARCHAR(8),
    ADD COLUMN IF NOT EXISTS placement VARCHAR(32),
    ADD COLUMN IF NOT EXISTS origin_x_formula VARCHAR(100),
    ADD COLUMN IF NOT EXISTS origin_y_formula VARCHAR(100),
    ADD COLUMN IF NOT EXISTS origin_z_formula VARCHAR(100),
    ADD COLUMN IF NOT EXISTS design_thickness_mm INT;

ALTER TABLE module_component_refs
    ADD COLUMN IF NOT EXISTS placement VARCHAR(32),
    ADD COLUMN IF NOT EXISTS origin_x_formula VARCHAR(100),
    ADD COLUMN IF NOT EXISTS origin_y_formula VARCHAR(100),
    ADD COLUMN IF NOT EXISTS origin_z_formula VARCHAR(100);
