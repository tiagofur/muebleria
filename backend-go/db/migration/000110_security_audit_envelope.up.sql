-- #461 / Gate A: make the existing append-only security audit authority
-- explicitly versioned and request-correlated. Audit remains synchronous;
-- no outbox is needed until a real asynchronous consumer exists.

ALTER TABLE security_audit_events
    ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN request_id TEXT;

ALTER TABLE security_audit_events
    ADD CONSTRAINT security_audit_events_schema_version_positive
        CHECK (schema_version > 0),
    ADD CONSTRAINT security_audit_events_request_id_shape
        CHECK (
            request_id IS NULL
            OR request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
        );

CREATE INDEX idx_security_audit_events_request
    ON security_audit_events(request_id)
    WHERE request_id IS NOT NULL;

-- Organization-less identity events are not tenant-wide. The subject may see
-- their own rows and active platform administrators may inspect the platform
-- trail; unrelated application actors must not see them through direct SQL.
DROP POLICY security_audit_read ON security_audit_events;
CREATE POLICY security_audit_read ON security_audit_events FOR SELECT
    USING (
        (organization_id IS NOT NULL AND app_has_organization_access(organization_id))
        OR (
            organization_id IS NULL
            AND (
                actor_user_id = app_current_user_id()
                OR target_user_id = app_current_user_id()
                OR app_current_user_is_platform_admin()
            )
        )
    );

DROP POLICY security_audit_insert ON security_audit_events;
CREATE POLICY security_audit_insert ON security_audit_events FOR INSERT
    WITH CHECK (
        actor_user_id IS NOT DISTINCT FROM app_current_user_id()
        AND (
            organization_id IS NULL
            OR app_has_organization_access(organization_id)
            OR app_current_user_is_platform_admin()
        )
    );

UPDATE rls_policy_inventory
SET read_scope = 'organization-or-identity-or-platform',
    write_scope = 'insert-only-actor-and-organization-or-platform',
    rationale = 'Security evidence is append-only; organization-less identity events are subject- or platform-visible only',
    policy_version = policy_version + 1,
    updated_at = NOW()
WHERE table_name = 'security_audit_events';
