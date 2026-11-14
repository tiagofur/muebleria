-- Restaura la validación original de 000130 (choiceId siempre UUID).
CREATE OR REPLACE FUNCTION valid_quote_commercial_snapshot_v1(payload JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT CASE
      WHEN jsonb_typeof(payload) = 'object'
       AND payload->>'schema' = 'granete.quote-commercial-snapshot.v1'
       AND valid_quote_commercial_timestamp_v1(payload->>'capturedAt')
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
                       OR NULLIF(BTRIM(option_value->>'choiceId'), '') IS NULL
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

