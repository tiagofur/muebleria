-- #451 / TEAM-2: sector assignments belong to one exact membership, never a
-- global user. Ambiguous legacy provenance aborts before any row is copied.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM user_sectors us
        LEFT JOIN memberships m
          ON m.user_id = us.user_id AND m.organization_id = us.organization_id
        LEFT JOIN organizations o ON o.id = us.organization_id
        GROUP BY us.user_id, us.organization_id, us.sector, us.sub_sector, o.type
        HAVING count(m.id) <> 1
            OR max(o.type) IS DISTINCT FROM 'factory'
    ) THEN
        RAISE EXCEPTION 'membership sectors migration blocked: legacy sector assignments require exact factory membership reconciliation'
            USING ERRCODE = '23514';
    END IF;
END $$;

ALTER TABLE memberships
    ADD CONSTRAINT memberships_id_organization_key UNIQUE (id, organization_id);

CREATE TABLE membership_sectors (
    membership_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    sector TEXT NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (membership_id, sector),
    CONSTRAINT membership_sectors_membership_organization_fk
        FOREIGN KEY (membership_id, organization_id)
        REFERENCES memberships(id, organization_id) ON DELETE CASCADE
);

INSERT INTO membership_sectors (membership_id, organization_id, sector, assigned_at)
SELECT m.id, us.organization_id, us.sector, us.created_at
FROM user_sectors us
JOIN memberships m ON m.user_id = us.user_id AND m.organization_id = us.organization_id;

CREATE INDEX idx_membership_sectors_organization_sector
    ON membership_sectors(organization_id, sector);
CREATE INDEX idx_membership_sectors_organization_membership
    ON membership_sectors(organization_id, membership_id);

ALTER TABLE membership_sectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_sectors FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON membership_sectors
    USING (organization_id = app_current_organization_id())
    WITH CHECK (organization_id = app_current_organization_id());

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES ('membership_sectors', 'tenant-owned', 'organization', 'organization',
        'Sector assignments are scoped to one exact organization membership')
ON CONFLICT (table_name) DO UPDATE SET classification=EXCLUDED.classification,
    read_scope=EXCLUDED.read_scope, write_scope=EXCLUDED.write_scope,
    rationale=EXCLUDED.rationale, policy_version=rls_policy_inventory.policy_version + 1,
    updated_at=NOW();
DELETE FROM rls_policy_inventory WHERE table_name = 'user_sectors';

GRANT SELECT, INSERT, UPDATE, DELETE ON membership_sectors TO granete_app;
DROP TABLE user_sectors;
