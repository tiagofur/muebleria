-- #394 / DT-10: requote provenance on QuoteRevision (ADR-0003, digital-thread
-- §§15–16, 25.5).
--
-- A QuoteRevision born from the explicit re-quote workflow records the exact
-- source quote revision and the exact DesignRevision whose commercial state
-- it incorporates. Both are composite FKs so provenance can never point at a
-- revision of another project. The columns are NULL for revisions with other
-- origins (manual/imported/system) and immutable once written — provenance is
-- history, not editable metadata.

ALTER TABLE quote_revisions
    ADD COLUMN base_quote_revision_id UUID NULL,
    ADD COLUMN source_design_revision_id UUID NULL;

ALTER TABLE quote_revisions
    ADD CONSTRAINT fk_quote_revisions_base
        FOREIGN KEY (base_quote_revision_id, project_id)
        REFERENCES quote_revisions(id, project_id),
    ADD CONSTRAINT fk_quote_revisions_source_design
        FOREIGN KEY (source_design_revision_id, project_id)
        REFERENCES design_revisions(id, project_id);

CREATE INDEX idx_quote_revisions_base ON quote_revisions(base_quote_revision_id);
CREATE INDEX idx_quote_revisions_source_design ON quote_revisions(source_design_revision_id);

-- Harden the immutability backstop: provenance is as immutable as source_type.
-- CREATE OR REPLACE is sufficient: protect_quote_revisions_immutable references
-- the function by name, so the trigger picks up the hardened body in place.
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
        IF NEW.base_quote_revision_id IS DISTINCT FROM OLD.base_quote_revision_id THEN
            RAISE EXCEPTION 'quote_revision base_quote_revision_id is immutable';
        END IF;
        IF NEW.source_design_revision_id IS DISTINCT FROM OLD.source_design_revision_id THEN
            RAISE EXCEPTION 'quote_revision source_design_revision_id is immutable';
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
