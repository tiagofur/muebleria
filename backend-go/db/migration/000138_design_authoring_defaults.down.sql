-- Down for #784 design authoring defaults. Restores the 000129 immutability
-- trigger shape (without authoring_defaults_snapshot) and drops the new
-- columns. Legacy rows were never backfilled, so there is no history to
-- restore.

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
       OR NEW.created_by_display_name IS DISTINCT FROM OLD.created_by_display_name THEN
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

ALTER TABLE design_revisions
    DROP CONSTRAINT IF EXISTS design_revisions_authoring_defaults_snapshot_object,
    DROP COLUMN IF EXISTS authoring_defaults_snapshot;

ALTER TABLE design_revision_items
    DROP CONSTRAINT IF EXISTS design_revision_items_material_choice_modes_object,
    DROP CONSTRAINT IF EXISTS design_revision_items_material_choice_modes_values,
    DROP COLUMN IF EXISTS material_choice_modes;

ALTER TABLE design_working_items
    DROP CONSTRAINT IF EXISTS design_working_items_material_choice_modes_object,
    DROP CONSTRAINT IF EXISTS design_working_items_material_choice_modes_values,
    DROP COLUMN IF EXISTS material_choice_modes;

ALTER TABLE design_working_copies
    DROP CONSTRAINT IF EXISTS design_working_copies_authoring_defaults_object,
    DROP COLUMN IF EXISTS authoring_defaults;

DROP FUNCTION IF EXISTS granete_design_material_choice_modes_valid(jsonb);

UPDATE rls_policy_inventory
SET rationale = CASE table_name
        WHEN 'design_working_copies' THEN 'Design working copy tracks the mutable authoring draft of a design (#387 / ADR-0003)'
        WHEN 'design_working_items' THEN 'Design working items represent the draft furniture instance positions and parameters in the working copy (#387 / ADR-0003)'
        WHEN 'design_revisions' THEN 'Immutable design revisions freeze human-readable presentation and actor provenance; legacy rows remain explicitly unavailable (#639)'
        WHEN 'design_revision_items' THEN 'Immutable design revisions freeze human-readable presentation and actor provenance; legacy rows remain explicitly unavailable (#639)'
    END,
    policy_version = GREATEST(policy_version - 1, 1),
    updated_at = NOW()
WHERE table_name IN ('design_working_copies', 'design_working_items', 'design_revisions', 'design_revision_items');
