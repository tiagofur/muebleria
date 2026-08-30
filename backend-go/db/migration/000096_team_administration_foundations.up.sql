-- #451 / TEAM-1: tenant-scoped team counters, explicit entitlements, and
-- membership credential revocation. Existing organizations are unlimited until
-- #452 provisions a commercial entitlement; no plan name is converted to seats.

-- 000081 created an active placeholder on an empty fresh database. It is not a
-- provisioned organization and must not remain active without an administrator.
UPDATE organizations o SET active = FALSE, updated_at = NOW()
WHERE o.id = '00000000-0000-0000-0000-000000000001'
  AND o.active
  AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM organizations o
        WHERE o.active
          AND NOT EXISTS (
              SELECT 1 FROM memberships m
              WHERE m.organization_id = o.id AND m.status = 'active' AND m.roles @> ARRAY['admin']::TEXT[]
          )
    ) THEN
        RAISE EXCEPTION 'team administration migration blocked: active organization without active admin requires reconciliation'
            USING ERRCODE = '23514';
    END IF;
END $$;

ALTER TABLE memberships
    ADD COLUMN credential_version BIGINT NOT NULL DEFAULT 1,
    ADD COLUMN sessions_revoked_at TIMESTAMPTZ,
    ADD COLUMN sessions_revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN sessions_revocation_reason TEXT,
    ADD CONSTRAINT memberships_credential_version_check CHECK (credential_version >= 1);

CREATE TABLE organization_team_state (
    organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    active_admin_count INTEGER NOT NULL DEFAULT 0 CHECK (active_admin_count >= 0),
    active_member_count INTEGER NOT NULL DEFAULT 0 CHECK (active_member_count >= 0),
	admin_bootstrap_pending BOOLEAN NOT NULL DEFAULT FALSE,
    version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE organization_entitlements (
    organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    max_active_members INTEGER CHECK (max_active_members IS NULL OR max_active_members >= 1),
    source TEXT NOT NULL DEFAULT 'legacy_unlimited' CHECK (source IN ('legacy_unlimited', 'provisioned')),
    version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO organization_team_state (organization_id, active_admin_count, active_member_count)
SELECT o.id,
       count(*) FILTER (WHERE m.status = 'active' AND m.roles @> ARRAY['admin']::TEXT[]),
       count(*) FILTER (WHERE m.status = 'active')
FROM organizations o LEFT JOIN memberships m ON m.organization_id = o.id
GROUP BY o.id;
INSERT INTO organization_entitlements (organization_id)
SELECT id FROM organizations;

CREATE OR REPLACE FUNCTION initialize_organization_team_foundations()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
	INSERT INTO organization_team_state (organization_id, admin_bootstrap_pending) VALUES (NEW.id, TRUE) ON CONFLICT DO NOTHING;
    INSERT INTO organization_entitlements (organization_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    RETURN NULL;
END $$;
CREATE TRIGGER initialize_organization_team_foundations
AFTER INSERT ON organizations FOR EACH ROW EXECUTE FUNCTION initialize_organization_team_foundations();

CREATE OR REPLACE FUNCTION apply_organization_team_delta(target_organization_id UUID, member_delta INTEGER, admin_delta INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    INSERT INTO organization_team_state (organization_id) VALUES (target_organization_id)
    ON CONFLICT (organization_id) DO NOTHING;
    UPDATE organization_team_state
    SET active_member_count = active_member_count + member_delta,
        active_admin_count = active_admin_count + admin_delta,
		admin_bootstrap_pending = CASE WHEN active_admin_count + admin_delta > 0 THEN FALSE ELSE admin_bootstrap_pending END,
        version = version + 1,
        updated_at = NOW()
    WHERE organization_id = target_organization_id;
END $$;

CREATE OR REPLACE FUNCTION refresh_team_state_on_membership_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE old_member INTEGER := 0; old_admin INTEGER := 0; new_member INTEGER := 0; new_admin INTEGER := 0;
BEGIN
    IF TG_OP <> 'INSERT' AND OLD.status = 'active' THEN
        old_member := 1;
        old_admin := CASE WHEN OLD.roles @> ARRAY['admin']::TEXT[] THEN 1 ELSE 0 END;
    END IF;
    IF TG_OP <> 'DELETE' AND NEW.status = 'active' THEN
        new_member := 1;
        new_admin := CASE WHEN NEW.roles @> ARRAY['admin']::TEXT[] THEN 1 ELSE 0 END;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN
        PERFORM apply_organization_team_delta(NEW.organization_id, new_member - old_member, new_admin - old_admin);
    ELSE
        IF TG_OP <> 'INSERT' THEN PERFORM apply_organization_team_delta(OLD.organization_id, -old_member, -old_admin); END IF;
        IF TG_OP <> 'DELETE' THEN PERFORM apply_organization_team_delta(NEW.organization_id, new_member, new_admin); END IF;
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER refresh_team_state_on_membership_change
AFTER INSERT OR UPDATE OR DELETE ON memberships
FOR EACH ROW EXECUTE FUNCTION refresh_team_state_on_membership_change();

CREATE OR REPLACE FUNCTION check_organization_team_invariants(target UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE active_org BOOLEAN; admins INTEGER; members INTEGER; max_members INTEGER; bootstrap_pending BOOLEAN;
BEGIN
	SELECT o.active, s.active_admin_count, s.active_member_count, e.max_active_members, s.admin_bootstrap_pending
	  INTO active_org, admins, members, max_members, bootstrap_pending
      FROM organizations o JOIN organization_team_state s ON s.organization_id=o.id
      JOIN organization_entitlements e ON e.organization_id=o.id WHERE o.id=target;
	IF active_org AND admins = 0 AND NOT bootstrap_pending THEN
        RAISE EXCEPTION 'organization team invariant: active organization requires an active admin' USING ERRCODE='23514', CONSTRAINT='organization_requires_active_admin';
    END IF;
    IF max_members IS NOT NULL AND members > max_members THEN
        RAISE EXCEPTION 'organization team invariant: active member seat limit exceeded' USING ERRCODE='23514', CONSTRAINT='organization_active_member_seat_limit';
    END IF;
END $$;
CREATE OR REPLACE FUNCTION enforce_team_invariants_from_membership()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN PERFORM check_organization_team_invariants(OLD.organization_id); END IF;
    IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.organization_id IS DISTINCT FROM OLD.organization_id) THEN
        PERFORM check_organization_team_invariants(NEW.organization_id);
    ELSIF TG_OP = 'UPDATE' THEN
        PERFORM check_organization_team_invariants(NEW.organization_id);
    END IF;
    RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION enforce_team_invariants_from_organization()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN PERFORM check_organization_team_invariants(NEW.id); RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION enforce_team_invariants_from_entitlement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN PERFORM check_organization_team_invariants(NEW.organization_id); RETURN NULL; END $$;
CREATE CONSTRAINT TRIGGER enforce_team_invariants_from_memberships
AFTER INSERT OR UPDATE OR DELETE ON memberships DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_team_invariants_from_membership();
CREATE CONSTRAINT TRIGGER enforce_team_invariants_from_organizations
AFTER INSERT OR UPDATE OF active ON organizations DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_team_invariants_from_organization();
CREATE CONSTRAINT TRIGGER enforce_team_invariants_from_entitlements
AFTER INSERT OR UPDATE OF max_active_members ON organization_entitlements DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_team_invariants_from_entitlement();

CREATE INDEX idx_memberships_active_admin ON memberships(organization_id) WHERE status = 'active' AND roles @> ARRAY['admin']::TEXT[];

ALTER TABLE organization_team_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_team_state FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organization_team_state
USING (organization_id = app_current_organization_id()) WITH CHECK (organization_id = app_current_organization_id());
ALTER TABLE organization_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_entitlements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organization_entitlements
USING (organization_id = app_current_organization_id()) WITH CHECK (organization_id = app_current_organization_id());
INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('organization_team_state', 'tenant-owned', 'organization', 'organization', 'Race-safe active membership/admin counters'),
 ('organization_entitlements', 'tenant-owned', 'organization', 'organization', 'Explicit tenant entitlement authority; NULL seat limit is legacy unlimited')
ON CONFLICT (table_name) DO UPDATE SET classification=EXCLUDED.classification, read_scope=EXCLUDED.read_scope,
 write_scope=EXCLUDED.write_scope, rationale=EXCLUDED.rationale, policy_version=rls_policy_inventory.policy_version + 1, updated_at=NOW();

GRANT SELECT, INSERT, UPDATE, DELETE ON organization_team_state, organization_entitlements TO granete_app;
REVOKE UPDATE ON organization_team_state FROM granete_app;
GRANT UPDATE (active_admin_count, active_member_count, version, updated_at) ON organization_team_state TO granete_app;
REVOKE ALL ON FUNCTION initialize_organization_team_foundations(), apply_organization_team_delta(UUID, INTEGER, INTEGER), refresh_team_state_on_membership_change(), check_organization_team_invariants(UUID), enforce_team_invariants_from_membership(), enforce_team_invariants_from_organization(), enforce_team_invariants_from_entitlement() FROM PUBLIC;
