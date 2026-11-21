-- #1648 (part 2) rollback: restore the 000137 trigger body, drop the columns.

CREATE OR REPLACE FUNCTION protect_quote_revision_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF current_setting('app.allow_project_cascade_delete', true) IS DISTINCT FROM 'on' THEN
            RAISE EXCEPTION 'quote_revisions cannot be deleted once created';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'INSERT' THEN
        -- Existing rows are the only legacy exception: they predate this
        -- trigger. Every post-migration INSERT must carry canonical authority.
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

        -- #642: the commercial snapshot is written exactly once, at creation.
        -- It can never be rewritten — not even from NULL (a revision without a
        -- snapshot is a legacy row and must stay honestly snapshot-less; the
        -- actionable path is a NEW revision, never a backfill mutation).
        IF NEW.commercial_snapshot IS DISTINCT FROM OLD.commercial_snapshot THEN
            RAISE EXCEPTION 'quote_revision commercial_snapshot is immutable once written';
        END IF;

        -- #642: real lifecycle timestamps. published_at may only be set by the
        -- draft → published transition; accepted_at only by published →
        -- accepted. Both are immutable afterwards (superseding keeps them).
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
            -- #642 fail-closed backstop: publishing requires the immutable
            -- commercial snapshot (legacy drafts must re-quote, not publish
            -- unpriced history).
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

ALTER TABLE quote_revisions DROP COLUMN IF EXISTS valid_until;
ALTER TABLE workshop_settings DROP CONSTRAINT IF EXISTS chk_workshop_settings_quote_validity_days;
ALTER TABLE workshop_settings DROP COLUMN IF EXISTS quote_validity_days;
ALTER TABLE workshop_settings DROP COLUMN IF EXISTS time_zone;
