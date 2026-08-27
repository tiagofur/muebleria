-- Reverts 000090 structurally only: historical role/license values are NOT
-- restored (they live in memberships / organizations). role regains its old
-- NOT NULL DEFAULT 'user' so pre-000090 code paths still boot after a
-- rollback.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user',
    ADD COLUMN IF NOT EXISTS license_plan TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS license_expires_at TIMESTAMPTZ;
