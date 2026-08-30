-- #483 / SU-API-2: authoritative typed parameter definitions belong to the
-- tenant-owned furniture definition (modules). Existing modules keep an empty
-- explicit list; the domain adapter projects their legacy width/height/depth
-- columns into the same typed contract without rewriting business data.
ALTER TABLE modules
    ADD COLUMN IF NOT EXISTS parameter_definitions JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE modules
    DROP CONSTRAINT IF EXISTS modules_parameter_definitions_array;

ALTER TABLE modules
    ADD CONSTRAINT modules_parameter_definitions_array
    CHECK (jsonb_typeof(parameter_definitions) = 'array');
