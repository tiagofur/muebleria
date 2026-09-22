-- Down for 000137 (#815): restore the pre-guard state — absolute durability
-- triggers, REVOKE DELETE barriers, no guard triggers. Independently
-- executable: it only touches objects created or redefined by 000137.

CREATE OR REPLACE FUNCTION protect_quote_revision_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'quote_revisions cannot be deleted once created';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.commercial_snapshot IS NULL THEN
            RAISE EXCEPTION 'new quote_revision requires commercial_snapshot; NULL is reserved for pre-#642 legacy rows';
        END IF;
        IF NOT valid_quote_commercial_snapshot_v1(NEW.commercial_snapshot) THEN
            RAISE EXCEPTION 'quote_revision commercial_snapshot is not a valid granete.quote-commercial-snapshot.v1 payload';
        END IF;
        IF NEW.status <> 'draft' OR NEW.published_at IS NOT NULL OR NEW.accepted_at IS NOT NULL THEN
            RAISE EXCEPTION 'quote_revision with commercial_snapshot must be inserted as draft without lifecycle timestamps';
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.id <> OLD.id OR NEW.project_id <> OLD.project_id OR NEW.organization_id <> OLD.organization_id THEN
            RAISE EXCEPTION 'quote_revision identity and project ownership are immutable';
        END IF;
        IF NEW.revision_number <> OLD.revision_number THEN
            RAISE EXCEPTION 'quote_revision revision_number is immutable';
        END IF;
        IF NEW.source_type <> OLD.source_type THEN
            RAISE EXCEPTION 'quote_revision source_type is immutable';
        END IF;
        IF NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION 'quote_revision created_at is immutable';
        END IF;
        IF NEW.commercial_snapshot IS DISTINCT FROM OLD.commercial_snapshot THEN
            RAISE EXCEPTION 'quote_revision commercial_snapshot is immutable once written';
        END IF;
        IF NEW.published_at IS DISTINCT FROM OLD.published_at THEN
            IF NOT (OLD.status = 'draft' AND NEW.status = 'published'
                    AND OLD.published_at IS NULL AND NEW.published_at IS NOT NULL) THEN
                RAISE EXCEPTION 'quote_revision published_at is set exactly once by the draft → published transition';
            END IF;
        END IF;
        IF NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN
            IF NOT (OLD.status = 'published' AND NEW.status = 'accepted'
                    AND OLD.accepted_at IS NULL AND NEW.accepted_at IS NOT NULL) THEN
                RAISE EXCEPTION 'quote_revision accepted_at is set exactly once by the published → accepted transition';
            END IF;
        END IF;
        IF NEW.status <> OLD.status THEN
            IF OLD.status = 'draft' AND NEW.status <> 'published' THEN
                RAISE EXCEPTION 'draft quote_revision can only transition to published, not %', NEW.status;
            END IF;
            IF OLD.status = 'draft' AND NEW.status = 'published'
                    AND (NEW.commercial_snapshot IS NULL
                         OR NOT valid_quote_commercial_snapshot_v1(NEW.commercial_snapshot)) THEN
                RAISE EXCEPTION 'draft quote_revision without a valid commercial_snapshot cannot be published';
            END IF;
            IF OLD.status = 'superseded' THEN
                RAISE EXCEPTION 'superseded quote_revision cannot transition to %', NEW.status;
            END IF;
            IF OLD.status = 'accepted' AND NEW.status <> 'superseded' THEN
                RAISE EXCEPTION 'accepted quote_revision can only transition to superseded, not %', NEW.status;
            END IF;
            IF OLD.status = 'published' AND NEW.status NOT IN ('accepted', 'superseded') THEN
                RAISE EXCEPTION 'published quote_revision can only transition to accepted or superseded, not %', NEW.status;
            END IF;
        END IF;
        IF OLD.status IN ('published', 'accepted', 'superseded') AND NEW.notes IS DISTINCT FROM OLD.notes THEN
            RAISE EXCEPTION '% quote_revision content cannot be modified', OLD.status;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

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

CREATE OR REPLACE FUNCTION protect_release_engineering_transitions()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'release engineering rows are durable history (#740)';
    END IF;
    IF NEW.release_id <> OLD.release_id OR NEW.project_id <> OLD.project_id
       OR NEW.organization_id <> OLD.organization_id
       OR NEW.started_by <> OLD.started_by OR NEW.started_at <> OLD.started_at THEN
        RAISE EXCEPTION 'release engineering identity is immutable (#740)';
    END IF;
    IF OLD.status = 'completed' THEN
        RAISE EXCEPTION 'release engineering completion is final (#740)';
    END IF;
    IF NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION 'release engineering version must advance by 1 (#740)';
    END IF;
    IF NEW.status = 'completed' AND (NEW.completed_by IS NULL OR NEW.completed_at IS NULL) THEN
        RAISE EXCEPTION 'completion requires actor and timestamp (#740)';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_release_manufacturing_snapshot_immutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'production release manufacturing snapshots are immutable history (#577)';
END;
$$;

CREATE OR REPLACE FUNCTION protect_production_release_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'production_releases are immutable history pinned to their exact revisions (#395 / I6 / §25.6)';
END;
$$;

CREATE OR REPLACE FUNCTION protect_design_revision_artifact_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'design_revision_artifacts is immutable once published';
END;
$$;

CREATE OR REPLACE FUNCTION protect_design_revision_item_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'design_revision_items is immutable';
END;
$$;

CREATE OR REPLACE FUNCTION protect_quote_revision_item_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'quote_revision_items is immutable once created';
END;
$$;

CREATE OR REPLACE FUNCTION protect_agregado_assembly_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '% is immutable once written', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION protect_hardware_asset_row_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '% is immutable once written', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS protect_furniture_instances_delete_guard ON furniture_instances;
DROP TRIGGER IF EXISTS protect_designs_delete_guard ON designs;
DROP TRIGGER IF EXISTS protect_design_publish_sessions_delete_guard ON design_publish_sessions;
DROP FUNCTION IF EXISTS protect_project_scoped_delete_guard();

DROP FUNCTION IF EXISTS delete_project_tree(uuid);
GRANT DELETE ON projects TO granete_app;

-- 000137 introduced no direct DELETE expansion: its canonical function owned
-- the cross-org boundary.  Down only removes that function and restores the
-- original absolute durability triggers above.
