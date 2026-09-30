-- 000141_manufacturing_library_overlays.down.sql

DELETE FROM rls_policy_inventory WHERE table_name IN ('library_overlay_conflicts', 'library_overlays');

DROP TABLE IF EXISTS library_overlay_conflicts CASCADE;
DROP TABLE IF EXISTS library_overlays CASCADE;
