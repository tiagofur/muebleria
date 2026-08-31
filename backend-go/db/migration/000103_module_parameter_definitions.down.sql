ALTER TABLE modules
    DROP CONSTRAINT IF EXISTS modules_parameter_definitions_array;

ALTER TABLE modules
    DROP COLUMN IF EXISTS parameter_definitions;
