-- ADR-0005: memberships are the source of truth for roles and the
-- organization owns licensing. The transitional users.role /
-- users.license_plan / users.license_expires_at columns have no readers or
-- writers left in the codebase (F176/F177) — drop them so stale data cannot
-- resurface.
ALTER TABLE users
    DROP COLUMN IF EXISTS role,
    DROP COLUMN IF EXISTS license_plan,
    DROP COLUMN IF EXISTS license_expires_at;
