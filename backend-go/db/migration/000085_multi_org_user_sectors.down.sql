DROP INDEX IF EXISTS idx_user_sectors_organization;
ALTER TABLE user_sectors DROP CONSTRAINT IF EXISTS user_sectors_organization_fk;
ALTER TABLE user_sectors DROP COLUMN IF EXISTS organization_id;
