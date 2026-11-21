-- #1662: price-only requote. A QuoteRevision born from re-pricing the exact
-- units of its base revision against the current catalog records
-- source_type = 'price_refresh' (base_quote_revision_id = the source; no
-- design revision provenance). The source_type CHECK gains the new origin;
-- immutability rules are unchanged (source_type stays immutable).

ALTER TABLE quote_revisions
    DROP CONSTRAINT IF EXISTS quote_revisions_source_type_check;
ALTER TABLE quote_revisions
    ADD CONSTRAINT quote_revisions_source_type_check
    CHECK (source_type IN ('manual', 'imported', 'requote', 'system', 'price_refresh'));
