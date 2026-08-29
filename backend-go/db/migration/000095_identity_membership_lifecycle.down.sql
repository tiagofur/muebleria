-- #450 rollback is allowed only while every post-migration fact can be
-- represented by the legacy booleans/timestamps. Take and verify a backup
-- before running this file. It fails closed rather than discarding lifecycle
-- history or authentication evidence.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM users
        WHERE email_verified_at IS NOT NULL OR last_login_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'cannot rollback IAM-1: user verification/login metadata would be lost; restore a verified pre-migration backup'
            USING ERRCODE = '55000';
    END IF;
    IF EXISTS (
        SELECT 1 FROM memberships
        WHERE status = 'left'
           OR joined_at IS DISTINCT FROM created_at
           OR suspended_at IS NOT NULL OR suspended_by IS NOT NULL OR suspension_reason IS NOT NULL
           OR left_at IS NOT NULL OR left_by IS NOT NULL OR leave_reason IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'cannot rollback IAM-1: membership lifecycle history is not representable by the legacy active boolean; restore a verified pre-migration backup'
            USING ERRCODE = '55000';
    END IF;
    IF EXISTS (
        SELECT 1 FROM invitations
        WHERE status IN ('delivered', 'opened')
           OR updated_at IS DISTINCT FROM created_at
           OR cardinality(previous_token_hashes) > 0
           OR revoked_by IS NOT NULL OR revoked_reason IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'cannot rollback IAM-1: invitation lifecycle history is not representable by the legacy schema; restore a verified pre-migration backup'
            USING ERRCODE = '55000';
    END IF;
END
$$;

DROP VIEW IF EXISTS identity_orphan_reconciliation_report;

REVOKE ALL ON FUNCTION lock_open_invitation_by_hash(TEXT) FROM granete_app;
DROP FUNCTION IF EXISTS lock_open_invitation_by_hash(TEXT);

ALTER TABLE users ADD COLUMN active BOOLEAN;
UPDATE users SET active = (account_status = 'active');
ALTER TABLE users ALTER COLUMN active SET NOT NULL, ALTER COLUMN active SET DEFAULT TRUE;

ALTER TABLE memberships ADD COLUMN active BOOLEAN;
UPDATE memberships SET active = (status = 'active');
ALTER TABLE memberships ALTER COLUMN active SET NOT NULL, ALTER COLUMN active SET DEFAULT TRUE;

DROP INDEX IF EXISTS idx_invitations_open_expiry;
DROP INDEX IF EXISTS idx_invitations_organization_status;
DROP INDEX IF EXISTS invitations_token_hash_key;
DROP INDEX IF EXISTS idx_invitations_open_org_normalized_email;
DROP INDEX IF EXISTS idx_memberships_user_status;
DROP INDEX IF EXISTS idx_memberships_organization_status;
DROP INDEX IF EXISTS users_normalized_email_key;

ALTER TABLE invitations
    DROP CONSTRAINT IF EXISTS invitations_lifecycle_consistency_check,
    DROP CONSTRAINT IF EXISTS invitations_status_check,
    DROP COLUMN IF EXISTS updated_at,
    DROP COLUMN IF EXISTS revoked_reason,
    DROP COLUMN IF EXISTS revoked_by,
    DROP COLUMN IF EXISTS previous_token_hashes,
    DROP COLUMN IF EXISTS status,
    DROP COLUMN IF EXISTS normalized_email;

CREATE UNIQUE INDEX idx_invitations_open_org_email
    ON invitations(organization_id, email)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE memberships
    DROP CONSTRAINT IF EXISTS memberships_lifecycle_consistency_check,
    DROP CONSTRAINT IF EXISTS memberships_status_check,
    DROP COLUMN IF EXISTS leave_reason,
    DROP COLUMN IF EXISTS left_by,
    DROP COLUMN IF EXISTS left_at,
    DROP COLUMN IF EXISTS suspension_reason,
    DROP COLUMN IF EXISTS suspended_by,
    DROP COLUMN IF EXISTS suspended_at,
    DROP COLUMN IF EXISTS joined_at,
    DROP COLUMN IF EXISTS status;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_account_status_check,
    DROP COLUMN IF EXISTS last_login_at,
    DROP COLUMN IF EXISTS email_verified_at,
    DROP COLUMN IF EXISTS account_status,
    DROP COLUMN IF EXISTS normalized_email;

REVOKE ALL ON FUNCTION normalize_identity_email(TEXT) FROM granete_app;
DROP FUNCTION IF EXISTS normalize_identity_email(TEXT);

CREATE FUNCTION lookup_open_invitation(invitation_token_hash TEXT)
RETURNS TABLE (
    id UUID,
    email VARCHAR(255),
    roles TEXT[],
    expires_at TIMESTAMPTZ,
    invited_by TEXT,
    accepted_at TIMESTAMPTZ,
    accepted_by TEXT,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    version BIGINT,
    organization_id UUID,
    organization_type TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT i.id, i.email, i.roles, i.expires_at, i.invited_by::TEXT,
           i.accepted_at, i.accepted_by::TEXT, i.revoked_at, i.created_at,
           i.version, o.id, o.type
    FROM invitations i
    JOIN organizations o ON o.id = i.organization_id
    WHERE i.token_hash = invitation_token_hash
      AND i.accepted_at IS NULL
      AND i.revoked_at IS NULL
      AND i.expires_at > NOW()
      AND o.active
$$;

REVOKE ALL ON FUNCTION lookup_open_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lookup_open_invitation(TEXT) TO granete_app;

UPDATE rls_policy_inventory
SET policy_version = 1,
    read_scope = CASE WHEN table_name = 'invitations' THEN 'organization' ELSE read_scope END,
    write_scope = CASE WHEN table_name = 'invitations' THEN 'organization' ELSE write_scope END,
    rationale = CASE table_name
        WHEN 'invitations' THEN 'Organization access command rows'
        WHEN 'memberships' THEN 'Self lookup supports organization selection; management remains tenant-scoped'
        WHEN 'users' THEN 'Global identities are not business tenant rows'
        ELSE rationale
    END,
    updated_at = NOW()
WHERE table_name IN ('users', 'memberships', 'invitations');
