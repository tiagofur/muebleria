ALTER TABLE quote_revisions
    DROP CONSTRAINT IF EXISTS quote_revisions_design_working_source_valid;
DROP FUNCTION IF EXISTS valid_quote_design_working_source_v1(JSONB);
