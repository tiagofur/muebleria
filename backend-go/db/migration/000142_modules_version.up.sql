-- #497 T2: optimistic concurrency for catalog modules.
-- Server-owned token surfaced as a strong ETag "v<N>"; create starts at 1 and
-- every accepted update increments it inside the update transaction. Existing
-- rows adopt 1 as their baseline.
ALTER TABLE modules ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE modules DROP CONSTRAINT IF EXISTS modules_version_positive;
ALTER TABLE modules ADD CONSTRAINT modules_version_positive CHECK (version >= 1);
