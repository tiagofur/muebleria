-- #452: bind every support session to the organization credential epoch that
-- authorized its creation. Middleware compares this immutable snapshot with
-- the live organization epoch on every request.

ALTER TABLE support_sessions
    ADD COLUMN organization_credential_version BIGINT;

UPDATE support_sessions session
SET organization_credential_version = organization.credential_version
FROM organizations organization
WHERE organization.id = session.organization_id;

ALTER TABLE support_sessions
    ALTER COLUMN organization_credential_version SET NOT NULL,
    ADD CONSTRAINT support_sessions_organization_credential_version_check
        CHECK (organization_credential_version >= 1),
    DROP CONSTRAINT support_sessions_ended_via_check,
    ADD CONSTRAINT support_sessions_ended_via_check
        CHECK (ended_via IN ('logout', 'expiry', 'org_suspended', 'org_offboarding'));

DROP TRIGGER protect_support_session_scope ON support_sessions;

CREATE OR REPLACE FUNCTION protect_support_session_scope()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
    IF OLD.platform_admin_user_id IS DISTINCT FROM NEW.platform_admin_user_id
       OR OLD.organization_id IS DISTINCT FROM NEW.organization_id
       OR OLD.organization_credential_version IS DISTINCT FROM NEW.organization_credential_version
    THEN
        RAISE EXCEPTION 'support session actor, organization, and credential version are immutable'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER protect_support_session_scope
    BEFORE UPDATE OF platform_admin_user_id, organization_id, organization_credential_version ON support_sessions
    FOR EACH ROW EXECUTE FUNCTION protect_support_session_scope();
