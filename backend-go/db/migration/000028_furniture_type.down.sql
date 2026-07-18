-- Reverse of 000028_furniture_type.up.sql (#109 / H14).

ALTER TABLE projects
    DROP COLUMN IF EXISTS measure_defaults;

ALTER TABLE modules
    DROP COLUMN IF EXISTS furniture_type;
