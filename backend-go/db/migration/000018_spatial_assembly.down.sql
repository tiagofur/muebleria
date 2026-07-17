ALTER TABLE module_component_refs
    DROP COLUMN IF EXISTS placement,
    DROP COLUMN IF EXISTS origin_x_formula,
    DROP COLUMN IF EXISTS origin_y_formula,
    DROP COLUMN IF EXISTS origin_z_formula;

ALTER TABLE component_board_parts
    DROP COLUMN IF EXISTS face,
    DROP COLUMN IF EXISTS placement,
    DROP COLUMN IF EXISTS origin_x_formula,
    DROP COLUMN IF EXISTS origin_y_formula,
    DROP COLUMN IF EXISTS origin_z_formula,
    DROP COLUMN IF EXISTS design_thickness_mm;

ALTER TABLE structure_board_parts
    DROP COLUMN IF EXISTS face,
    DROP COLUMN IF EXISTS placement,
    DROP COLUMN IF EXISTS origin_x_formula,
    DROP COLUMN IF EXISTS origin_y_formula,
    DROP COLUMN IF EXISTS origin_z_formula,
    DROP COLUMN IF EXISTS design_thickness_mm;

ALTER TABLE board_parts
    DROP COLUMN IF EXISTS face,
    DROP COLUMN IF EXISTS placement,
    DROP COLUMN IF EXISTS origin_x_formula,
    DROP COLUMN IF EXISTS origin_y_formula,
    DROP COLUMN IF EXISTS origin_z_formula,
    DROP COLUMN IF EXISTS design_thickness_mm;
