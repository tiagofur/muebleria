-- #642 / QUOTE-AUTH Slice 1 (down): restore the pre-#642 trigger body
-- (000116 semantics) and drop the commercial-authority columns. Consistent
-- with repo rules: the down path is real, not a stub.

CREATE OR REPLACE FUNCTION protect_quote_revision_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'quote_revisions cannot be deleted once created';
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

        IF NEW.status <> OLD.status THEN
            IF OLD.status = 'draft' AND NEW.status <> 'published' THEN
                RAISE EXCEPTION 'draft quote_revision can only transition to published, not %', NEW.status;
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

DROP TRIGGER protect_quote_revisions_immutable ON quote_revisions;
CREATE TRIGGER protect_quote_revisions_immutable
    BEFORE UPDATE OR DELETE ON quote_revisions
    FOR EACH ROW
    EXECUTE FUNCTION protect_quote_revision_immutability();

ALTER TABLE quote_revisions
    DROP COLUMN IF EXISTS commercial_snapshot,
    DROP COLUMN IF EXISTS published_at,
    DROP COLUMN IF EXISTS accepted_at;

DROP FUNCTION IF EXISTS valid_quote_commercial_snapshot_v1(JSONB);
DROP FUNCTION IF EXISTS valid_quote_commercial_line_amounts_v1(JSONB);
DROP FUNCTION IF EXISTS valid_quote_commercial_breakdown_v1(JSONB);

UPDATE rls_policy_inventory
SET rationale = 'Project quote revisions are historical snapshots; mutations are restricted strictly to lifecycle transitions (#393 / ADR-0003)',
    policy_version = GREATEST(policy_version - 1, 1),
    updated_at = NOW()
WHERE table_name = 'quote_revisions';
