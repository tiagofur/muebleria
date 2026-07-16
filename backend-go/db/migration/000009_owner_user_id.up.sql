-- F034 / #66: portfolio ownership on customers and projects.
-- Backfill: projects use created_by when present; otherwise first active admin.
-- Customers with no owner also get the first active admin.

ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

UPDATE projects
SET owner_user_id = created_by
WHERE owner_user_id IS NULL
  AND created_by IS NOT NULL;

UPDATE projects
SET owner_user_id = (
    SELECT id FROM users
    WHERE role = 'admin' AND active = true
    ORDER BY created_at ASC
    LIMIT 1
)
WHERE owner_user_id IS NULL;

UPDATE customers
SET owner_user_id = (
    SELECT id FROM users
    WHERE role = 'admin' AND active = true
    ORDER BY created_at ASC
    LIMIT 1
)
WHERE owner_user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_customers_owner_user_id ON customers (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner_user_id ON projects (owner_user_id);
