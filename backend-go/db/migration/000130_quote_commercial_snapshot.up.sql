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

-- Database backstop for direct SQL writers. PostgreSQL validates both the v1
-- envelope and its amount authority; a structurally present but commercially
-- empty/corrupt payload cannot cross the lifecycle boundary.
CREATE OR REPLACE FUNCTION valid_quote_commercial_breakdown_v1(amounts JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT CASE WHEN jsonb_typeof(amounts) = 'object'
                 AND jsonb_typeof(amounts->'materials_cost') = 'number'
                 AND jsonb_typeof(amounts->'edge_total') = 'number'
                 AND jsonb_typeof(amounts->'hardware_total') = 'number'
                 AND jsonb_typeof(amounts->'direct_cost') = 'number'
                 AND jsonb_typeof(amounts->'labor_modular') = 'number'
                 AND jsonb_typeof(amounts->'labor_fixed_cost') = 'number'
                 AND jsonb_typeof(amounts->'margin_factor') = 'number'
                 AND jsonb_typeof(amounts->'sale_price') = 'number'
           THEN (amounts->>'materials_cost')::numeric >= 0
             AND (amounts->>'edge_total')::numeric >= 0
             AND (amounts->>'hardware_total')::numeric >= 0
             AND (amounts->>'direct_cost')::numeric >= 0
             AND (amounts->>'labor_modular')::numeric >= 0
             AND (amounts->>'labor_fixed_cost')::numeric >= 0
             AND (amounts->>'margin_factor')::numeric > 0
             AND (amounts->>'sale_price')::numeric >= 0
           ELSE FALSE END;
$$;

CREATE OR REPLACE FUNCTION valid_quote_commercial_line_amounts_v1(amounts JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT CASE WHEN jsonb_typeof(amounts) = 'object'
                 AND jsonb_typeof(amounts->'materialsCost') = 'number'
                 AND jsonb_typeof(amounts->'edgeTotal') = 'number'
                 AND jsonb_typeof(amounts->'hardwareTotal') = 'number'
                 AND jsonb_typeof(amounts->'directCost') = 'number'
                 AND jsonb_typeof(amounts->'laborModular') = 'number'
                 AND jsonb_typeof(amounts->'salePrice') = 'number'
           THEN (amounts->>'materialsCost')::numeric >= 0
             AND (amounts->>'edgeTotal')::numeric >= 0
             AND (amounts->>'hardwareTotal')::numeric >= 0
             AND (amounts->>'directCost')::numeric >= 0
             AND (amounts->>'laborModular')::numeric >= 0
             AND (amounts->>'salePrice')::numeric >= 0
           ELSE FALSE END;
$$;

CREATE OR REPLACE FUNCTION valid_quote_commercial_snapshot_v1(payload JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT CASE
      WHEN jsonb_typeof(payload) = 'object'
       AND payload->>'schema' = 'granete.quote-commercial-snapshot.v1'
       AND NULLIF(BTRIM(payload->>'capturedAt'), '') IS NOT NULL
       AND NULLIF(BTRIM(payload->>'currency'), '') IS NOT NULL
       AND jsonb_typeof(payload->'customer') = 'object'
       AND NULLIF(BTRIM(payload#>>'{customer,id}'), '') IS NOT NULL
       AND NULLIF(BTRIM(payload#>>'{customer,name}'), '') IS NOT NULL
       AND jsonb_typeof(payload->'project') = 'object'
       AND NULLIF(BTRIM(payload#>>'{project,id}'), '') IS NOT NULL
       AND NULLIF(BTRIM(payload#>>'{project,name}'), '') IS NOT NULL
       AND valid_quote_commercial_breakdown_v1(payload->'breakdown')
       AND jsonb_typeof(payload->'lines') = 'array'
       AND jsonb_array_length(payload->'lines') > 0
       AND jsonb_typeof(payload->'units') = 'array'
       AND jsonb_array_length(payload->'units') > 0
      THEN
       NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(payload->'lines') AS line
           WHERE COALESCE(jsonb_typeof(line), '') <> 'object'
              OR NULLIF(BTRIM(line->>'quoteLineId'), '') IS NULL
              OR line->>'quoteLineId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              OR COALESCE(jsonb_typeof(line->'quantity'), '') <> 'number'
              OR CASE WHEN jsonb_typeof(line->'quantity') = 'number'
                      THEN (line->>'quantity')::numeric < 0
                        OR SCALE((line->>'quantity')::numeric) <> 0
                      ELSE FALSE END
              OR COALESCE(jsonb_typeof(line->'furnitureInstanceIds'), '') <> 'array'
              OR CASE WHEN jsonb_typeof(line->'furnitureInstanceIds') = 'array'
                      THEN jsonb_array_length(line->'furnitureInstanceIds') = 0
                        OR EXISTS (
                            SELECT 1 FROM jsonb_array_elements_text(line->'furnitureInstanceIds') AS id
                            WHERE id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                        )
                      ELSE FALSE END
              OR NOT valid_quote_commercial_line_amounts_v1(line->'amounts')
       )
       AND (SELECT COUNT(*) = COUNT(DISTINCT line->>'quoteLineId')
              FROM jsonb_array_elements(payload->'lines') AS line)
       AND (SELECT COUNT(*) = COUNT(DISTINCT instance_id)
              FROM jsonb_array_elements(payload->'lines') AS line
              CROSS JOIN LATERAL jsonb_array_elements_text(line->'furnitureInstanceIds') AS instance_id)
       AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(payload->'units') AS unit
           WHERE COALESCE(jsonb_typeof(unit), '') <> 'object'
              OR unit->>'furnitureInstanceId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              OR unit->>'quoteLineId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              OR NULLIF(BTRIM(unit->>'moduleCode'), '') IS NULL
              OR unit->>'moduleCode' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              OR NULLIF(BTRIM(unit->>'moduleName'), '') IS NULL
              OR unit->>'moduleName' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              OR COALESCE(unit->>'lifecycleStatus', '') NOT IN ('active', 'removed', 'cancelled')
              OR COALESCE(jsonb_typeof(unit->'options'), '') <> 'array'
              OR CASE WHEN jsonb_typeof(unit->'options') = 'array' THEN EXISTS (
                    SELECT 1
                    FROM (
                        SELECT option_value,
                               LAG(option_value->>'groupCode') OVER (ORDER BY ordinal) AS previous_group
                        FROM jsonb_array_elements(unit->'options') WITH ORDINALITY AS option_item(option_value, ordinal)
                    ) AS ordered_option
                    WHERE COALESCE(jsonb_typeof(option_value), '') <> 'object'
                       OR NULLIF(BTRIM(option_value->>'groupCode'), '') IS NULL
                       OR option_value->>'groupCode' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       OR NULLIF(BTRIM(option_value->>'groupLabel'), '') IS NULL
                       OR option_value->>'groupLabel' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       OR option_value->>'choiceId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       OR NULLIF(BTRIM(option_value->>'choiceLabel'), '') IS NULL
                       OR option_value->>'choiceLabel' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       OR (previous_group IS NOT NULL AND previous_group >= option_value->>'groupCode')
                 ) ELSE FALSE END
       )
       AND (SELECT COUNT(*) = COUNT(DISTINCT unit->>'furnitureInstanceId')
              FROM jsonb_array_elements(payload->'units') AS unit)
       -- Every physical identity is represented exactly once on both sides of
       -- the commercial grouping, and every unit binds to its owning line.
       AND NOT EXISTS (
           SELECT 1
             FROM jsonb_array_elements(payload->'units') AS unit
            WHERE NOT EXISTS (
                SELECT 1
                  FROM jsonb_array_elements(payload->'lines') AS line
                 WHERE line->>'quoteLineId' = unit->>'quoteLineId'
                   AND (line->'furnitureInstanceIds') ? (unit->>'furnitureInstanceId')
            )
       )
       AND NOT EXISTS (
           SELECT 1
             FROM jsonb_array_elements(payload->'lines') AS line
             CROSS JOIN LATERAL jsonb_array_elements_text(line->'furnitureInstanceIds') AS instance_id
            WHERE NOT EXISTS (
                SELECT 1
                  FROM jsonb_array_elements(payload->'units') AS unit
                 WHERE unit->>'quoteLineId' = line->>'quoteLineId'
                   AND unit->>'furnitureInstanceId' = instance_id
            )
       )
       -- Quantity is the positive active count while a line is active. Zero is
       -- reserved for terminal-only historical lines (removed/cancelled); a
       -- superseded QuoteRevision preserves this frozen unit lifecycle.
       AND NOT EXISTS (
           SELECT 1
             FROM jsonb_array_elements(payload->'lines') AS line
            WHERE (line->>'quantity')::numeric < 0
               OR SCALE((line->>'quantity')::numeric) <> 0
               OR (line->>'quantity')::numeric <> (
                    SELECT COUNT(*)::numeric
                      FROM jsonb_array_elements(payload->'units') AS unit
                     WHERE unit->>'quoteLineId' = line->>'quoteLineId'
                       AND unit->>'lifecycleStatus' = 'active'
               )
       )
       AND (
           SELECT ABS(SUM((line#>>'{amounts,materialsCost}')::numeric)
                          - (payload#>>'{breakdown,materials_cost}')::numeric)
                      <= GREATEST(1, ABS((payload#>>'{breakdown,materials_cost}')::numeric)) * 0.000000001
              AND ABS(SUM((line#>>'{amounts,edgeTotal}')::numeric)
                          - (payload#>>'{breakdown,edge_total}')::numeric)
                      <= GREATEST(1, ABS((payload#>>'{breakdown,edge_total}')::numeric)) * 0.000000001
              AND ABS(SUM((line#>>'{amounts,hardwareTotal}')::numeric)
                          - (payload#>>'{breakdown,hardware_total}')::numeric)
                      <= GREATEST(1, ABS((payload#>>'{breakdown,hardware_total}')::numeric)) * 0.000000001
              AND ABS(SUM((line#>>'{amounts,directCost}')::numeric)
                          - (payload#>>'{breakdown,direct_cost}')::numeric)
                      <= GREATEST(1, ABS((payload#>>'{breakdown,direct_cost}')::numeric)) * 0.000000001
              AND ABS(SUM((line#>>'{amounts,laborModular}')::numeric)
                          - (payload#>>'{breakdown,labor_modular}')::numeric)
                      <= GREATEST(1, ABS((payload#>>'{breakdown,labor_modular}')::numeric)) * 0.000000001
              AND ABS(SUM((line#>>'{amounts,salePrice}')::numeric)
                          + (payload#>>'{breakdown,labor_fixed_cost}')::numeric
                          - (payload#>>'{breakdown,sale_price}')::numeric)
                      <= GREATEST(1, ABS((payload#>>'{breakdown,sale_price}')::numeric)) * 0.000000001
           FROM jsonb_array_elements(payload->'lines') AS line
       )
      ELSE FALSE
    END;
$$;

CREATE OR REPLACE FUNCTION protect_quote_revision_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'quote_revisions cannot be deleted once created';
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

DROP TRIGGER protect_quote_revisions_immutable ON quote_revisions;
CREATE TRIGGER protect_quote_revisions_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON quote_revisions
    FOR EACH ROW
    EXECUTE FUNCTION protect_quote_revision_immutability();

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
