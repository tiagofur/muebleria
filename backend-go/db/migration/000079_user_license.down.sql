ALTER TABLE users
    DROP COLUMN IF EXISTS license_expires_at,
    DROP COLUMN IF EXISTS license_plan;
