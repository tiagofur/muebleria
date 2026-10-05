-- #1091 (#443 slice 2): server-owned version columns for optimistic
-- concurrency on the simple catalog families (If-Match guarded writes),
-- mirroring hardwares (#1089) and hardware_profiles (#443/#448).
ALTER TABLE material_boards    ADD COLUMN version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE edge_bands         ADD COLUMN version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE option_groups      ADD COLUMN version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE module_categories  ADD COLUMN version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE customers          ADD COLUMN version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE material_categories ADD COLUMN version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE ambient_materials  ADD COLUMN version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE ambient_categories ADD COLUMN version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1);
