-- TEAM-2 rollback refuses to collapse membership-scoped assignments that the
-- legacy user-level primary key cannot represent without loss.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM membership_sectors ms
        JOIN memberships m ON m.id = ms.membership_id
        GROUP BY m.user_id, ms.sector
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'cannot rollback TEAM-2: membership sectors collide across organizations; restore a verified pre-migration backup'
            USING ERRCODE = '55000';
    END IF;
END $$;

CREATE TABLE user_sectors (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sector TEXT NOT NULL,
    sub_sector TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    PRIMARY KEY (user_id, sector, sub_sector)
);
INSERT INTO user_sectors (user_id, sector, organization_id, created_at)
SELECT m.user_id, ms.sector, ms.organization_id, ms.assigned_at
FROM membership_sectors ms JOIN memberships m ON m.id = ms.membership_id;
CREATE INDEX idx_user_sectors_user ON user_sectors(user_id);
CREATE INDEX idx_user_sectors_sector ON user_sectors(sector);
CREATE INDEX idx_user_sectors_organization ON user_sectors(organization_id);
ALTER TABLE user_sectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sectors FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON user_sectors
    USING (organization_id = app_current_organization_id())
    WITH CHECK (organization_id = app_current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON user_sectors TO granete_app;

DELETE FROM rls_policy_inventory WHERE table_name = 'membership_sectors';
INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES ('user_sectors', 'tenant-owned', 'organization', 'organization',
        'Legacy sector assignments belong to an organization tenant')
ON CONFLICT (table_name) DO UPDATE SET classification=EXCLUDED.classification,
    read_scope=EXCLUDED.read_scope, write_scope=EXCLUDED.write_scope,
    rationale=EXCLUDED.rationale, policy_version=rls_policy_inventory.policy_version + 1,
    updated_at=NOW();
DROP TABLE membership_sectors;
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_id_organization_key;
