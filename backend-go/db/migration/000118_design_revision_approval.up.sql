-- #395 / DT-11: DesignRevision approval (ADR-0003, digital-thread §§17, 22, 28
-- Phase 8).
--
-- `published` and `approved` are different truths: publishing records design
-- history; approval explicitly authorizes the revision for production. The
-- snapshot itself stays immutable (#387 / I4 / I12): the ONLY update the table
-- ever accepts is the exact published→approved lifecycle transition, which
-- records approved_by/approved_at exactly once and touches nothing else.

ALTER TABLE design_revisions
    ADD COLUMN approved_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN approved_at TIMESTAMPTZ NULL;

-- Harden the immutability backstop with the single approval carve-out.
-- CREATE OR REPLACE is sufficient: protect_design_revisions_immutable
-- references the function by name, so the trigger picks up the new body in
-- place (same mechanism as the #394 quote lifecycle trigger). The trigger is
-- the semantic authority for the exact published→approved transition; the
-- RLS policy above is the tenancy authority (owner org only, result must be
-- approved).
CREATE OR REPLACE FUNCTION protect_design_revision_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'design_revisions cannot be deleted once published';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- Identity, ownership, provenance and content are immutable (#387).
        IF NEW.id <> OLD.id OR NEW.project_id <> OLD.project_id OR NEW.organization_id <> OLD.organization_id THEN
            RAISE EXCEPTION 'design_revision identity and project ownership are immutable';
        END IF;
        IF NEW.design_id <> OLD.design_id
           OR NEW.revision_number <> OLD.revision_number
           OR NEW.parent_revision_id IS DISTINCT FROM OLD.parent_revision_id
           OR NEW.source_type <> OLD.source_type
           OR NEW.created_by IS DISTINCT FROM OLD.created_by
           OR NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION 'design_revision snapshot fields are immutable';
        END IF;

        -- #395: the only legal mutation is a first-time approval transition.
        IF NOT (
            OLD.status = 'published' AND NEW.status = 'approved'
            AND OLD.approved_by IS NULL AND OLD.approved_at IS NULL
            AND NEW.approved_by IS NOT NULL AND NEW.approved_at IS NOT NULL
        ) THEN
            RAISE EXCEPTION 'design_revisions is immutable except the published→approved approval transition';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

ALTER TABLE design_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_revisions FORCE ROW LEVEL SECURITY;

CREATE POLICY design_revisions_approve ON design_revisions
    FOR UPDATE TO granete_app
    USING (
        app_can_access_project(project_id)
        AND organization_id = app_current_organization_id()
    )
    WITH CHECK (
        app_can_access_project(project_id)
        AND organization_id = app_current_organization_id()
        AND status = 'approved'
    );

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('design_revisions', 'explicitly-shared', 'project-organizations', 'owner-organization-approval-transition', 'Published design revisions are immutable snapshots following project organizations; the owner organization may transition a published revision to approved exactly once (#387 / #395 / I4 / I12 / §17)')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();

GRANT SELECT, INSERT, UPDATE ON design_revisions TO granete_app;
REVOKE DELETE ON design_revisions FROM granete_app;
