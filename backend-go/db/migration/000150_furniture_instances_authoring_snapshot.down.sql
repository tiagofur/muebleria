-- 000150_furniture_instances_authoring_snapshot.down.sql
-- Drop the #977 recovery snapshot column. Rollback loses the captured
-- authoring state (re-placement falls back to the pre-#977 seeds) but leaves
-- identity, lifecycle and grants exactly as they were.

ALTER TABLE furniture_instances
    DROP COLUMN IF EXISTS authoring_snapshot;
