-- Rollback for #772 [P1][LIB-1]: Manufacturing library foundation.
-- Removes tables in reverse dependency order.

-- T2: Remove pinning columns
ALTER TABLE production_releases
    DROP COLUMN IF EXISTS effective_library_release_id;

ALTER TABLE design_revisions
    DROP COLUMN IF EXISTS effective_library_release_id;

ALTER TABLE design_working_copies
    DROP COLUMN IF EXISTS effective_library_release_id;

-- Restore design_revision immutability trigger to its 000138 form (without #772 column).
CREATE OR REPLACE FUNCTION protect_design_revision_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF current_setting('app.allow_project_cascade_delete', true) IS DISTINCT FROM 'on' THEN
            RAISE EXCEPTION 'design_revisions cannot be deleted once published';
        END IF;
        RETURN OLD;
    END IF;
    IF NEW.id <> OLD.id OR NEW.project_id <> OLD.project_id OR NEW.organization_id <> OLD.organization_id
       OR NEW.design_id <> OLD.design_id OR NEW.revision_number <> OLD.revision_number
       OR NEW.parent_revision_id IS DISTINCT FROM OLD.parent_revision_id OR NEW.source_type <> OLD.source_type
       OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at <> OLD.created_at
       OR NEW.created_by_display_name IS DISTINCT FROM OLD.created_by_display_name
       OR NEW.authoring_defaults_snapshot IS DISTINCT FROM OLD.authoring_defaults_snapshot THEN
        RAISE EXCEPTION 'design_revision snapshot fields are immutable';
    END IF;
    IF NOT (
        OLD.status = 'published' AND NEW.status = 'approved'
        AND OLD.approved_by IS NULL AND OLD.approved_at IS NULL
        AND OLD.approved_by_display_name IS NULL
        AND NEW.approved_by IS NOT NULL AND NEW.approved_at IS NOT NULL
        AND NEW.approved_by_display_name IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'design_revisions is immutable except the published→approved approval transition';
    END IF;
    RETURN NEW;
END;
$$;

UPDATE rls_policy_inventory
SET rationale = 'Immutable design revisions freeze the working copy authoring defaults of the publish moment (#784) alongside human-readable presentation and actor provenance; legacy rows remain explicitly unavailable (#639 / #784)',
    policy_version = policy_version + 1,
    updated_at = NOW()
WHERE table_name = 'design_revisions';

UPDATE rls_policy_inventory
SET rationale = 'Design working copies carry the durable Design-scoped authoring defaults (#784); reads follow project organizations and writes stay with the owner organization (#387 / #810 / ADR-0003)',
    policy_version = policy_version + 1,
    updated_at = NOW()
WHERE table_name = 'design_working_copies';

-- T1: Remove tables (resource_refs first, then releases, then libraries)
DELETE FROM rls_policy_inventory WHERE table_name IN (
    'library_release_resource_refs',
    'library_releases',
    'manufacturing_libraries'
);

DROP TABLE IF EXISTS library_release_resource_refs;
DROP TABLE IF EXISTS library_releases;
DROP TABLE IF EXISTS manufacturing_libraries;
