-- Read-only preflight for the invitation acceptance screen (#1108): resolves
-- the invitation context (organization, roles, masked email, account
-- existence) without locking or consuming the invitation. SECURITY DEFINER
-- like lock_open_invitation_by_hash so the pre-auth lookup bypasses RLS.
CREATE FUNCTION read_open_invitation_by_hash(invitation_token_hash TEXT)
RETURNS TABLE (
    normalized_email VARCHAR(255), roles TEXT[], status TEXT,
    expires_at TIMESTAMPTZ, current_token BOOLEAN,
    organization_name TEXT, account_exists BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public ROWS 1
AS $$
    SELECT i.normalized_email, i.roles, i.status, i.expires_at,
           i.token_hash = invitation_token_hash,
           o.name,
           EXISTS (SELECT 1 FROM users u WHERE u.normalized_email = i.normalized_email)
      FROM invitations i JOIN organizations o ON o.id = i.organization_id
     WHERE (i.token_hash = invitation_token_hash
            OR invitation_token_hash = ANY (i.previous_token_hashes))
       AND o.status = 'active'
     LIMIT 1
$$;

REVOKE ALL ON FUNCTION read_open_invitation_by_hash(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION read_open_invitation_by_hash(TEXT) TO granete_app;
