-- #692: pin the exact OutputCompatibilityProfile data used by a selection.
-- Historical rows deliberately remain NULL: assigning today's digest would
-- fabricate identity for a choice made before the digest was persisted.
ALTER TABLE machine_output_selections
    ADD COLUMN output_profile_digest TEXT NULL;

ALTER TABLE machine_output_selections
    ADD CONSTRAINT machine_output_selections_profile_digest_format
    CHECK (output_profile_digest IS NULL OR output_profile_digest ~ '^[0-9a-f]{64}$');
