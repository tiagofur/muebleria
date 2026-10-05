-- #1084 (#443 slice 1): server-owned version column for optimistic
-- concurrency on catalog hardware writes (If-Match guarded PUT/DELETE),
-- mirroring hardware_profiles (#443/#448 contract).
ALTER TABLE hardwares
    ADD COLUMN version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1);
