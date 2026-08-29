ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM granete_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE USAGE, SELECT ON SEQUENCES FROM granete_app;

DO $$
DECLARE
    relation RECORD;
BEGIN
    FOR relation IN
        SELECT schemaname, tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND rowsecurity
    LOOP
        EXECUTE format('ALTER TABLE %I.%I NO FORCE ROW LEVEL SECURITY', relation.schemaname, relation.tablename);
        EXECUTE format('ALTER TABLE %I.%I DISABLE ROW LEVEL SECURITY', relation.schemaname, relation.tablename);
    END LOOP;
END
$$;

DO $$
DECLARE
    relation RECORD;
BEGIN
    FOR relation IN SELECT table_name FROM rls_policy_inventory
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', relation.table_name);
    END LOOP;
END
$$;

DROP POLICY IF EXISTS project_explicit_organizations_read ON projects;
DROP POLICY IF EXISTS project_explicit_organizations_insert ON projects;
DROP POLICY IF EXISTS project_explicit_organizations_update ON projects;
DROP POLICY IF EXISTS project_explicit_organizations_delete ON projects;
DROP POLICY IF EXISTS project_explicit_organizations ON project_items;
DROP POLICY IF EXISTS project_explicit_organizations ON project_level_choices;
DROP POLICY IF EXISTS project_explicit_organizations ON quote_snapshots;
DROP POLICY IF EXISTS project_item_choice_explicit_organizations ON project_item_choices;
DROP POLICY IF EXISTS snapshot_price_explicit_organizations ON snapshot_prices;
DROP POLICY IF EXISTS membership_read ON memberships;
DROP POLICY IF EXISTS membership_write ON memberships;
DROP POLICY IF EXISTS idempotency_actor_scope ON api_idempotency_receipts;
DROP POLICY IF EXISTS support_session_read ON support_sessions;
DROP POLICY IF EXISTS support_session_insert ON support_sessions;
DROP POLICY IF EXISTS support_session_update ON support_sessions;
DROP POLICY IF EXISTS security_audit_read ON security_audit_events;
DROP POLICY IF EXISTS security_audit_insert ON security_audit_events;
DROP POLICY IF EXISTS stock_movement_read ON stock_movements;
DROP POLICY IF EXISTS stock_movement_insert ON stock_movements;
DROP POLICY IF EXISTS structure_revision_read ON structure_revisions;
DROP POLICY IF EXISTS structure_revision_insert ON structure_revisions;

DROP TRIGGER IF EXISTS protect_project_organization_ownership ON projects;
DROP FUNCTION IF EXISTS protect_project_organization_ownership();
DROP FUNCTION IF EXISTS app_can_access_project(UUID);
DROP FUNCTION IF EXISTS app_current_support_session_id();
DROP FUNCTION IF EXISTS app_has_organization_access(UUID);
DROP FUNCTION IF EXISTS lookup_open_invitation(TEXT);
DROP FUNCTION IF EXISTS app_current_membership_id();
DROP FUNCTION IF EXISTS app_current_user_id();
DROP FUNCTION IF EXISTS app_current_organization_id();

DROP TABLE IF EXISTS rls_policy_inventory;
DROP INDEX IF EXISTS idx_api_idempotency_receipts_org_actor;
ALTER TABLE api_idempotency_receipts
    DROP COLUMN IF EXISTS actor_user_id,
    DROP COLUMN IF EXISTS organization_id;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'granete_app') THEN
        DROP OWNED BY granete_app;
    END IF;
END
$$;

GRANT SET ON PARAMETER row_security TO PUBLIC;
