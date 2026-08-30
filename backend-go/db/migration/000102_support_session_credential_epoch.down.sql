-- The pre-000102 schema cannot represent an explicit offboarding end reason.
-- Refuse a lossy rollback once that fact exists.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM support_sessions WHERE ended_via = 'org_offboarding'
    ) THEN
        RAISE EXCEPTION 'cannot rollback support-session offboarding facts; restore a verified pre-migration backup'
            USING ERRCODE = '55000';
    END IF;
END $$;

DROP TRIGGER protect_support_session_scope ON support_sessions;

CREATE OR REPLACE FUNCTION protect_support_session_scope()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
    IF OLD.platform_admin_user_id IS DISTINCT FROM NEW.platform_admin_user_id
       OR OLD.organization_id IS DISTINCT FROM NEW.organization_id
    THEN
        RAISE EXCEPTION 'support session actor and organization are immutable'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER protect_support_session_scope
    BEFORE UPDATE OF platform_admin_user_id, organization_id ON support_sessions
    FOR EACH ROW EXECUTE FUNCTION protect_support_session_scope();

ALTER TABLE support_sessions
    DROP CONSTRAINT support_sessions_ended_via_check,
    ADD CONSTRAINT support_sessions_ended_via_check
        CHECK (ended_via IN ('logout', 'expiry', 'org_suspended')),
    DROP CONSTRAINT support_sessions_organization_credential_version_check,
    DROP COLUMN organization_credential_version;
