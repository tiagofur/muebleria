-- #1662 rollback: restore the original source_type CHECK. Fails (by design)
-- while price_refresh revisions exist — history is never rewritten.
ALTER TABLE quote_revisions
    DROP CONSTRAINT IF EXISTS quote_revisions_source_type_check;
ALTER TABLE quote_revisions
    ADD CONSTRAINT quote_revisions_source_type_check
    CHECK (source_type IN ('manual', 'imported', 'requote', 'system'));
