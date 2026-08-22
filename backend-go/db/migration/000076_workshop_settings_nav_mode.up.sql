-- OC-092 (#305): navigation surface by workshop size ('simplified' small
-- shop vs 'departmental' default). Presentation only — RBAC keeps filtering
-- on top of either mode.
ALTER TABLE workshop_settings ADD COLUMN IF NOT EXISTS nav_mode TEXT;
UPDATE workshop_settings SET nav_mode = 'departmental' WHERE nav_mode IS NULL;
