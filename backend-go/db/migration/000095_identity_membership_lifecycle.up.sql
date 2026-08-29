-- #450 / IAM-1: separate global account, organization membership and
-- invitation lifecycles. Historical values are preserved conservatively;
-- ambiguous identity collisions abort the whole transactional migration.

CREATE FUNCTION normalize_identity_email(candidate TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
    SELECT lower(btrim(candidate))
$$;

REVOKE ALL ON FUNCTION normalize_identity_email(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION normalize_identity_email(TEXT) TO granete_app;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM users
        GROUP BY normalize_identity_email(email)
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'identity lifecycle migration blocked: normalized email collisions require administrative reconciliation'
            USING ERRCODE = '23505';
    END IF;
    IF EXISTS (SELECT 1 FROM users WHERE normalize_identity_email(email) = '') THEN
        RAISE EXCEPTION 'identity lifecycle migration blocked: empty normalized email requires administrative reconciliation'
            USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
        SELECT 1 FROM invitations GROUP BY token_hash HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'identity lifecycle migration blocked: duplicate invitation token hashes require administrative reconciliation'
            USING ERRCODE = '23505';
    END IF;
    IF EXISTS (SELECT 1 FROM invitations WHERE normalize_identity_email(email) = '') THEN
        RAISE EXCEPTION 'identity lifecycle migration blocked: empty invitation normalized email requires administrative reconciliation'
            USING ERRCODE = '23514';
    END IF;
END
$$;

ALTER TABLE users
    ADD COLUMN normalized_email VARCHAR(255),
    ADD COLUMN account_status TEXT,
    ADD COLUMN email_verified_at TIMESTAMPTZ,
    ADD COLUMN last_login_at TIMESTAMPTZ;

UPDATE users
SET email = btrim(email),
    normalized_email = normalize_identity_email(email),
    account_status = CASE WHEN active THEN 'active' ELSE 'disabled' END;

ALTER TABLE users
    ALTER COLUMN normalized_email SET NOT NULL,
    ALTER COLUMN account_status SET NOT NULL,
    ALTER COLUMN account_status SET DEFAULT 'active',
    ADD CONSTRAINT users_account_status_check
        CHECK (account_status IN ('active', 'disabled')),
    ADD CONSTRAINT users_canonical_email_check
        CHECK (
            email = btrim(email)
            AND normalized_email <> ''
            AND normalized_email = normalize_identity_email(email)
        );

CREATE UNIQUE INDEX users_normalized_email_key ON users(normalized_email);

ALTER TABLE memberships
    ADD COLUMN status TEXT,
    ADD COLUMN joined_at TIMESTAMPTZ,
    ADD COLUMN suspended_at TIMESTAMPTZ,
    ADD COLUMN suspended_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN suspension_reason TEXT,
    ADD COLUMN left_at TIMESTAMPTZ,
    ADD COLUMN left_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN leave_reason TEXT;

UPDATE memberships
SET status = CASE WHEN active THEN 'active' ELSE 'suspended' END,
    joined_at = created_at;

ALTER TABLE memberships
    ALTER COLUMN status SET NOT NULL,
    ALTER COLUMN status SET DEFAULT 'active',
    ALTER COLUMN joined_at SET NOT NULL,
    ALTER COLUMN joined_at SET DEFAULT NOW(),
    ADD CONSTRAINT memberships_status_check
        CHECK (status IN ('active', 'suspended', 'left')),
    ADD CONSTRAINT memberships_lifecycle_consistency_check CHECK (
        (status = 'active'
            AND suspended_at IS NULL AND suspended_by IS NULL AND suspension_reason IS NULL
            AND left_at IS NULL AND left_by IS NULL AND leave_reason IS NULL)
        OR
        (status = 'suspended'
            AND left_at IS NULL AND left_by IS NULL AND leave_reason IS NULL
            AND (
                (suspended_at IS NULL AND suspended_by IS NULL AND suspension_reason IS NULL)
                OR suspended_at IS NOT NULL
            ))
        OR
        (status = 'left'
            AND left_at IS NOT NULL
            AND suspended_at IS NULL AND suspended_by IS NULL AND suspension_reason IS NULL)
    );

CREATE INDEX idx_memberships_organization_status
    ON memberships(organization_id, status);
CREATE INDEX idx_memberships_user_status
    ON memberships(user_id, status);

ALTER TABLE invitations
    ADD COLUMN normalized_email VARCHAR(255),
    ADD COLUMN status TEXT,
    ADD COLUMN revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN revoked_reason TEXT,
    ADD COLUMN previous_token_hashes TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Remove the legacy raw-email partial index before canonicalizing. The
-- transaction restores it automatically if any reconciliation check fails.
DROP INDEX IF EXISTS idx_invitations_open_org_email;

UPDATE invitations
SET email = btrim(email),
    normalized_email = normalize_identity_email(email),
    status = CASE
        WHEN accepted_at IS NOT NULL THEN 'accepted'
        WHEN revoked_at IS NOT NULL THEN 'revoked'
        WHEN expires_at <= NOW() THEN 'expired'
        ELSE 'pending'
    END,
    updated_at = created_at;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM invitations
        WHERE status IN ('pending', 'delivered', 'opened')
        GROUP BY organization_id, normalized_email
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'identity lifecycle migration blocked: duplicate open invitations require administrative reconciliation'
            USING ERRCODE = '23505';
    END IF;
END
$$;

ALTER TABLE invitations
    ALTER COLUMN normalized_email SET NOT NULL,
    ALTER COLUMN status SET NOT NULL,
    ALTER COLUMN status SET DEFAULT 'pending',
    ADD CONSTRAINT invitations_status_check
        CHECK (status IN ('pending', 'delivered', 'opened', 'accepted', 'expired', 'revoked')),
    ADD CONSTRAINT invitations_canonical_email_check
        CHECK (
            email = btrim(email)
            AND normalized_email <> ''
            AND normalized_email = normalize_identity_email(email)
        ),
    ADD CONSTRAINT invitations_lifecycle_consistency_check CHECK (
        (status IN ('pending', 'delivered', 'opened', 'expired')
            AND accepted_at IS NULL AND accepted_by IS NULL
            AND revoked_at IS NULL AND revoked_by IS NULL AND revoked_reason IS NULL)
        OR
        (status = 'accepted' AND accepted_at IS NOT NULL)
        OR
        (status = 'revoked' AND accepted_at IS NULL AND accepted_by IS NULL AND revoked_at IS NOT NULL)
    );

CREATE UNIQUE INDEX idx_invitations_open_org_normalized_email
    ON invitations(organization_id, normalized_email)
    WHERE status IN ('pending', 'delivered', 'opened');
CREATE UNIQUE INDEX invitations_token_hash_key ON invitations(token_hash);
CREATE INDEX idx_invitations_organization_status
    ON invitations(organization_id, status, created_at DESC);
CREATE INDEX idx_invitations_open_expiry
    ON invitations(expires_at)
    WHERE status IN ('pending', 'delivered', 'opened');

-- The compatibility booleans are removed only after every replacement value
-- has been written and constrained, leaving one mutable authority per lifecycle.
ALTER TABLE users DROP COLUMN active;
ALTER TABLE memberships DROP COLUMN active;

-- Exact-hash public acceptance boundary. The row lock serializes acceptance
-- before User/Membership creation. The function owner is the migration owner;
-- runtime receives EXECUTE only and never receives token_hash or a list surface.
DROP FUNCTION IF EXISTS lookup_open_invitation(TEXT);
CREATE FUNCTION lock_open_invitation_by_hash(invitation_token_hash TEXT)
RETURNS TABLE (
    id UUID,
    normalized_email VARCHAR(255),
    roles TEXT[],
    status TEXT,
    expires_at TIMESTAMPTZ,
    invited_by UUID,
    accepted_at TIMESTAMPTZ,
    accepted_by UUID,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID,
    revoked_reason TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    version BIGINT,
    organization_id UUID,
    organization_type TEXT,
    current_token BOOLEAN
)
LANGUAGE SQL
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
ROWS 1
AS $$
    SELECT i.id, i.normalized_email, i.roles, i.status, i.expires_at,
           i.invited_by, i.accepted_at, i.accepted_by, i.revoked_at,
           i.revoked_by, i.revoked_reason, i.created_at, i.updated_at,
           i.version, o.id, o.type, i.token_hash = invitation_token_hash
    FROM invitations i
    JOIN organizations o ON o.id = i.organization_id
    WHERE (i.token_hash = invitation_token_hash OR invitation_token_hash = ANY(i.previous_token_hashes))
      AND o.active
    FOR UPDATE OF i
$$;

REVOKE ALL ON FUNCTION lock_open_invitation_by_hash(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_open_invitation_by_hash(TEXT) TO granete_app;

UPDATE rls_policy_inventory
SET policy_version = 2,
    read_scope = 'organization-or-exact-token-lock',
    write_scope = 'organization-transaction',
    rationale = 'Invitation lifecycle is tenant-owned; public acceptance can lock only one exact open token hash',
    updated_at = NOW()
WHERE table_name = 'invitations';

UPDATE rls_policy_inventory
SET policy_version = 2,
    rationale = 'Explicit active/suspended/left membership lifecycle; self lookup supports organization selection and management remains tenant-scoped',
    updated_at = NOW()
WHERE table_name = 'memberships';

UPDATE rls_policy_inventory
SET policy_version = 2,
    rationale = 'Global identities use explicit account status and normalized unique email; no organization administrator account authority',
    updated_at = NOW()
WHERE table_name = 'users';

-- Migration-owner-only report for disabled identities that were never linked to
-- any organization or invitation. It deliberately receives no runtime grant.
CREATE VIEW identity_orphan_reconciliation_report
WITH (security_barrier = true)
AS
SELECT u.id AS user_id, u.normalized_email, u.created_at
FROM users u
WHERE u.account_status = 'disabled'
  AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)
  AND NOT EXISTS (
      SELECT 1 FROM invitations i
      WHERE i.normalized_email = u.normalized_email
  );

REVOKE ALL ON identity_orphan_reconciliation_report FROM PUBLIC;
REVOKE ALL ON identity_orphan_reconciliation_report FROM granete_app;

COMMENT ON VIEW identity_orphan_reconciliation_report IS
    'IAM-1 administrative report. Reconcile explicitly; never auto-assign, merge, or delete these disabled identities.';
