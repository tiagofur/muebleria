-- #1096 (#443 slice 3): server-owned version columns for optimistic
-- concurrency on the structural catalog families, mirroring the simple
-- families (#1091) and hardware (#1089).
ALTER TABLE components ADD COLUMN version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE structures ADD COLUMN version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE agregados  ADD COLUMN version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1);
