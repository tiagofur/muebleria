-- #639: immutable human-readable DesignRevision presentation snapshots.
-- Existing revisions are intentionally not backfilled: mutable catalog data
-- cannot be used to reconstruct historical truth.

ALTER TABLE design_working_items
    ADD COLUMN material_choice_sources JSONB NULL,
    ADD CONSTRAINT design_working_items_material_choice_sources_object
        CHECK (material_choice_sources IS NULL OR jsonb_typeof(material_choice_sources) = 'object');

ALTER TABLE design_revision_items
    ADD COLUMN material_choice_sources JSONB NULL,
    ADD COLUMN presentation_snapshot JSONB NULL,
    ADD CONSTRAINT design_revision_items_material_choice_sources_object
        CHECK (material_choice_sources IS NULL OR jsonb_typeof(material_choice_sources) = 'object'),
    ADD CONSTRAINT design_revision_items_presentation_snapshot_object
        CHECK (presentation_snapshot IS NULL OR jsonb_typeof(presentation_snapshot) = 'object');

ALTER TABLE design_revisions
    ADD COLUMN created_by_display_name TEXT NULL,
    ADD COLUMN approved_by_display_name TEXT NULL,
    ADD CONSTRAINT design_revisions_created_by_display_name_nonempty
        CHECK (created_by_display_name IS NULL OR btrim(created_by_display_name) <> ''),
    ADD CONSTRAINT design_revisions_approved_by_display_name_nonempty
        CHECK (approved_by_display_name IS NULL OR btrim(approved_by_display_name) <> '');

CREATE OR REPLACE FUNCTION protect_design_revision_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'design_revisions cannot be deleted once published';
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

UPDATE rls_policy_inventory
SET rationale = 'Immutable design revisions freeze human-readable presentation and actor provenance; legacy rows remain explicitly unavailable (#639)',
    policy_version = policy_version + 1,
    updated_at = NOW()
WHERE table_name IN ('design_revisions', 'design_revision_items');
