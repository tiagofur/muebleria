CREATE OR REPLACE FUNCTION valid_quote_design_working_source_v1(source JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT jsonb_typeof(source) = 'object'
       AND (SELECT count(*) = 3 FROM jsonb_object_keys(source))
       AND source->>'designId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND NULLIF(BTRIM(source->>'workingVersion'), '') IS NOT NULL
       AND source->>'workingFingerprint' ~ '^sha256-[0-9a-f]{64}$';
$$;

ALTER TABLE quote_revisions
    ADD CONSTRAINT quote_revisions_design_working_source_valid
    CHECK (commercial_snapshot IS NULL
        OR NOT commercial_snapshot ? 'designSource'
        OR valid_quote_design_working_source_v1(commercial_snapshot->'designSource'));
