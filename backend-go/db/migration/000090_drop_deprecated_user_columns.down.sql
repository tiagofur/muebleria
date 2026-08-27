-- Reverts 000090 structurally only: historical role/license values are NOT
-- restored (they live in memberships / organizations). role regains its old
-- NOT NULL DEFAULT 'user' so pre-000090 code paths still boot after a
-- rollback.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user',
    ADD COLUMN IF NOT EXISTS license_plan TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS license_expires_at TIMESTAMPTZ;

-- The pre-000090 era enforced the canonical 8 (000051's users_role_check);
-- restore the same CHECK so a rollback cannot re-open rejected role ids.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN (
        'admin',
        'user',
        'vendedor',
        'gerente_ventas',
        'gerente_produccion',
        'ingeniero',
        'produccion',
        'almacen'
    ));
