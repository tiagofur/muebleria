-- F050 / #100: Revert presets de medida y estirado de estructuras

DROP TABLE IF EXISTS structure_presets CASCADE;

ALTER TABLE structure_board_parts DROP COLUMN IF EXISTS length_formula;
ALTER TABLE structure_board_parts DROP COLUMN IF EXISTS width_formula;
