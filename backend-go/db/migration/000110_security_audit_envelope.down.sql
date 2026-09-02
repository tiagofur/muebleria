-- #461 / Gate A rollback: restore the pre-envelope audit shape and policy.
DROP POLICY security_audit_read ON security_audit_events;
CREATE POLICY security_audit_read ON security_audit_events FOR SELECT
    USING (organization_id IS NULL OR app_has_organization_access(organization_id));

DROP POLICY security_audit_insert ON security_audit_events;
CREATE POLICY security_audit_insert ON security_audit_events FOR INSERT
    WITH CHECK (
        actor_user_id IS NOT DISTINCT FROM app_current_user_id()
        AND (
            organization_id IS NULL
            OR app_has_organization_access(organization_id)
        )
    );

UPDATE rls_policy_inventory
SET read_scope = 'organization',
    write_scope = 'insert-only-organization',
    rationale = 'Security evidence is append-only and tenant-scoped',
    policy_version = policy_version + 1,
    updated_at = NOW()
WHERE table_name = 'security_audit_events';

DROP INDEX idx_security_audit_events_request;
ALTER TABLE security_audit_events
    DROP CONSTRAINT security_audit_events_request_id_shape,
    DROP CONSTRAINT security_audit_events_schema_version_positive,
    DROP COLUMN request_id,
    DROP COLUMN schema_version;
