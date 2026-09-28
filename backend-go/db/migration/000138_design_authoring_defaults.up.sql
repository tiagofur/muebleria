-- #784: durable Design authoring defaults + explicit per-role inheritance
-- modes. OWNER DECISIONS 2026-09-28:
--   * material_choice_modes is a SEPARATE dimension from
--     material_choice_sources (commercial/authorial provenance is untouched);
--   * existing working items migrate conservatively: every materialized role
--     becomes 'override' — inheritance is NEVER inferred from value equality;
--   * mode=design is lineage, not a live pointer: items keep their
--     materialized choices; drift is projected (needsRollout), never applied.
-- Existing revision rows are intentionally NOT backfilled (#784 follows the
-- #639 precedent): historical truth cannot be reconstructed, and the
-- whole-row immutability trigger forbids touching published items. Legacy
-- revision items read material_choice_modes = NULL ⇒ every materialized role
-- interprets conservatively as 'override'; new publishes always write modes.

-- CHECK constraints cannot contain subqueries; the mode-enum guard lives in
-- an IMMUTABLE function of its argument only (deterministic, no table access).
CREATE OR REPLACE FUNCTION granete_design_material_choice_modes_valid(modes jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $func$
    SELECT NOT EXISTS (
        SELECT 1 FROM jsonb_each_text(modes)
        WHERE value NOT IN ('design', 'override')
    )
$func$;

ALTER TABLE design_working_copies
    ADD COLUMN authoring_defaults JSONB NOT NULL DEFAULT '{"materialChoices":{}}'::jsonb,
    ADD CONSTRAINT design_working_copies_authoring_defaults_object
        CHECK (jsonb_typeof(authoring_defaults) = 'object');

ALTER TABLE design_working_items
    ADD COLUMN material_choice_modes JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD CONSTRAINT design_working_items_material_choice_modes_object
        CHECK (jsonb_typeof(material_choice_modes) = 'object'),
    ADD CONSTRAINT design_working_items_material_choice_modes_values
        CHECK (granete_design_material_choice_modes_valid(material_choice_modes));

-- Conservative backfill: every already-materialized role of an existing
-- working item becomes an explicit 'override'. This is a lineage statement
-- made once at contract birth — it never compares values against defaults,
-- quotes or any other item.
UPDATE design_working_items
SET material_choice_modes = COALESCE(
    (SELECT jsonb_object_agg(role, to_jsonb('override'::text))
     FROM jsonb_object_keys(material_choices) AS role),
    '{}'::jsonb
);

ALTER TABLE design_revisions
    ADD COLUMN authoring_defaults_snapshot JSONB NULL,
    ADD CONSTRAINT design_revisions_authoring_defaults_snapshot_object
        CHECK (authoring_defaults_snapshot IS NULL OR jsonb_typeof(authoring_defaults_snapshot) = 'object');

ALTER TABLE design_revision_items
    ADD COLUMN material_choice_modes JSONB NULL,
    ADD CONSTRAINT design_revision_items_material_choice_modes_object
        CHECK (material_choice_modes IS NULL OR jsonb_typeof(material_choice_modes) = 'object'),
    ADD CONSTRAINT design_revision_items_material_choice_modes_values
        CHECK (granete_design_material_choice_modes_valid(material_choice_modes));

-- The design_revisions immutability trigger enumerates the immutable snapshot
-- fields; authoring_defaults_snapshot joins that list (approval remains the
-- only legal transition).
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
SET rationale = 'Design working copies carry the durable Design-scoped authoring defaults (#784); reads follow project organizations and writes stay with the owner organization (#387 / #810 / ADR-0003)',
    policy_version = policy_version + 1,
    updated_at = NOW()
WHERE table_name = 'design_working_copies';

UPDATE rls_policy_inventory
SET rationale = 'Design working items carry materialized choices plus explicit per-role inheritance modes (#784: design|override, never derived by equality); scope follows the parent working copy (#387 / #810)',
    policy_version = policy_version + 1,
    updated_at = NOW()
WHERE table_name = 'design_working_items';

UPDATE rls_policy_inventory
SET rationale = 'Immutable design revisions freeze the working copy authoring defaults of the publish moment (#784) alongside human-readable presentation and actor provenance; legacy rows remain explicitly unavailable (#639 / #784)',
    policy_version = policy_version + 1,
    updated_at = NOW()
WHERE table_name = 'design_revisions';

UPDATE rls_policy_inventory
SET rationale = 'Design revision items freeze materialized choices, provenance and per-role inheritance modes (#784: design|override); legacy rows read NULL modes as conservative override (#387 / #639 / #784 / I4 / I12)',
    policy_version = policy_version + 1,
    updated_at = NOW()
WHERE table_name = 'design_revision_items';
