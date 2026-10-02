-- 000148_overlay_version.down.sql

ALTER TABLE library_overlays
    DROP COLUMN IF EXISTS version;
