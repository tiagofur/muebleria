-- ADR-0004 / #325: sector assignments are scoped to the organization where
-- the operator works. Backfilled from the membership created in 000081.

ALTER TABLE user_sectors ADD COLUMN IF NOT EXISTS organization_id UUID;

UPDATE user_sectors us
SET organization_id = m.organization_id
FROM memberships m
WHERE m.user_id = us.user_id
  AND m.active
  AND us.organization_id IS NULL;

UPDATE user_sectors
SET organization_id = '00000000-0000-0000-0000-000000000001'
WHERE organization_id IS NULL;

ALTER TABLE user_sectors ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE user_sectors
    ADD CONSTRAINT user_sectors_organization_fk FOREIGN KEY (organization_id)
    REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_user_sectors_organization ON user_sectors(organization_id);
