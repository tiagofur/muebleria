-- F040: optional catalog image URL (path to media file, not base64)

ALTER TABLE material_boards
    ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT '';

ALTER TABLE hardwares
    ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT '';

ALTER TABLE modules
    ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT '';
