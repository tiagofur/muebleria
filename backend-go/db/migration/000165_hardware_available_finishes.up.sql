-- #1209 PR1: selectable commercial finish presets per hardware. NULL/empty
-- = no finish choice offered (fail-closed default for every existing row).
ALTER TABLE hardwares ADD COLUMN IF NOT EXISTS available_finishes JSONB;
