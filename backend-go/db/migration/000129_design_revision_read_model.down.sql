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
       OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'design_revision snapshot fields are immutable';
    END IF;
    IF NOT (OLD.status = 'published' AND NEW.status = 'approved'
        AND OLD.approved_by IS NULL AND OLD.approved_at IS NULL
        AND NEW.approved_by IS NOT NULL AND NEW.approved_at IS NOT NULL) THEN
        RAISE EXCEPTION 'design_revisions is immutable except the published→approved approval transition';
    END IF;
    RETURN NEW;
END;
$$;

ALTER TABLE design_revisions
    DROP CONSTRAINT IF EXISTS design_revisions_created_by_display_name_nonempty,
    DROP CONSTRAINT IF EXISTS design_revisions_approved_by_display_name_nonempty,
    DROP COLUMN IF EXISTS created_by_display_name,
    DROP COLUMN IF EXISTS approved_by_display_name;

ALTER TABLE design_revision_items
    DROP CONSTRAINT IF EXISTS design_revision_items_material_choice_sources_object,
    DROP CONSTRAINT IF EXISTS design_revision_items_presentation_snapshot_object,
    DROP COLUMN IF EXISTS material_choice_sources,
    DROP COLUMN IF EXISTS presentation_snapshot;

ALTER TABLE design_working_items
    DROP CONSTRAINT IF EXISTS design_working_items_material_choice_sources_object,
    DROP COLUMN IF EXISTS material_choice_sources;
