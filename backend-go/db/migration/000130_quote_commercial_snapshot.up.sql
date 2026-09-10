-- #642 / QUOTE-AUTH Slice 1: the exact QuoteRevision becomes the sole
-- canonical commercial authority (digital-thread §16A).
--
-- Additive columns on the existing canonical quote_revisions persistence — no
-- parallel QuoteSnapshot table, no second quote domain:
--
--   commercial_snapshot JSONB     — immutable server-owned commercial payload
--                                    `granete.quote-commercial-snapshot.v1`
--                                    (currency, customer/project commercial
--                                    identity, authoritative breakdown computed
--                                    once at creation, frozen per-unit customer
--                                    descriptors, capturedAt). NULL only for
--                                    legacy revisions created before #642.
--   published_at TIMESTAMPTZ      — real lifecycle event set by the draft →
--                                    published transition. Never created_at.
--   accepted_at  TIMESTAMPTZ      — real lifecycle event set by the published
--                                    → accepted transition. Never updated_at.
--
-- Legacy fail-closed rule (DB backstop): a draft WITHOUT commercial_snapshot
-- can never be published — historical commercial truth must be reproducible
-- without mutable state, and a missing snapshot is never recalculated from the
-- current project/catalog/settings (#642 "missing snapshot → fail closed").
--
-- Classification unchanged: explicitly-shared, project-organizations read,
-- owner-organization write. The new columns ride the existing row policies.

ALTER TABLE quote_revisions
    ADD COLUMN commercial_snapshot JSONB NULL
        CHECK (jsonb_typeof(commercial_snapshot) IS NULL
            OR jsonb_typeof(commercial_snapshot) = 'object'),
    ADD COLUMN published_at TIMESTAMPTZ NULL,
    ADD COLUMN accepted_at TIMESTAMPTZ NULL;

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
            IF OLD.status = 'draft' AND NEW.status = 'published' AND NEW.commercial_snapshot IS NULL THEN
                RAISE EXCEPTION 'draft quote_revision without commercial_snapshot cannot be published';
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

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('quote_revisions', 'explicitly-shared', 'project-organizations', 'owner-organization', 'Project quote revisions are immutable historical snapshots and the sole canonical commercial authority (#393 / ADR-0003 / #642 §16A): the owner organization may only perform lifecycle transitions; the commercial snapshot and lifecycle timestamps are immutable once written')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();
