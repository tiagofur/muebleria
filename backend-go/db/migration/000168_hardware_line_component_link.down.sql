-- #1394 down: drop the optional component link on module hardware lines.
ALTER TABLE hardware_lines
    DROP COLUMN IF EXISTS component_id;
