-- 000149_policy_draft.down.sql

ALTER TABLE library_overlays
    DROP COLUMN IF EXISTS policy_draft;
