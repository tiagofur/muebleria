-- #1530 (ADR-0009 Amendment 1, A2.1 / opening-front-system.md §14.2, §14.9):
-- gola profile v2. ADDITIVE: the legacy columns (grip_type,
-- compatible_placements, door_reduction_mm, front_reduction_mm +
-- grip_clearance_mm, datasheet_status) stay readable until the engine (#1529),
-- the profile editor (#1534) and the project grip (#1532) stop reading them.
--
-- New workshop-owned fields:
--   material                  aluminum | melamine (melamine = Italian gola)
--   positions                 top | between (both materials)
--   front_discount_top_mm     the workshop's front discount at the top edge
--   front_discount_between_mm the workshop's front discount between fronts
-- No upper bound on the discounts (#1524 Q5): only > 0.
-- v2_migration is the per-row migration report (read-only, server-written).
--
-- RLS classification is unchanged: same table, same tenant-owned policies.
ALTER TABLE opening_profiles
    ADD COLUMN IF NOT EXISTS material TEXT
        CHECK (material IS NULL OR material IN ('aluminum', 'melamine')),
    ADD COLUMN IF NOT EXISTS positions TEXT[] NOT NULL DEFAULT '{}'
        CHECK (positions <@ ARRAY['top', 'between']::TEXT[]),
    ADD COLUMN IF NOT EXISTS front_discount_top_mm INTEGER
        CHECK (front_discount_top_mm IS NULL OR front_discount_top_mm > 0),
    ADD COLUMN IF NOT EXISTS front_discount_between_mm INTEGER
        CHECK (front_discount_between_mm IS NULL OR front_discount_between_mm > 0),
    ADD COLUMN IF NOT EXISTS v2_migration JSONB;

-- 1. Grip types that are not profiles (handle, bottom_reveal, none) leave
--    the catalog: deactivated with a report. Nothing is deleted, so pinned
--    designs keep their frozen slice.
UPDATE opening_profiles
SET v2_migration = jsonb_build_object(
        'migration', '000180',
        'issue', 1530,
        'action', 'deactivated',
        'reason', 'grip_type_not_profile',
        'grip_type', grip_type,
        'was_active', active
    ),
    active = FALSE,
    version = version + 1,
    updated_at = NOW()
WHERE v2_migration IS NULL
  AND grip_type <> 'gola';

-- 2. Gola rows: material, positions, top discount and the strip role.
WITH source AS (
    SELECT
        p.id,
        -- The only component member (#1327 Italian strip) moves to the fixed
        -- `strip` role. Two or more component members are reported, not
        -- guessed.
        (SELECT array_agg(m.key ORDER BY m.key)
           FROM jsonb_each(p.bom_members) AS m(key, value)
          WHERE COALESCE(m.value->>'component_id', '') <> '') AS component_keys,
        (SELECT array_agg(m.key ORDER BY m.key)
           FROM jsonb_each(p.bom_members) AS m(key, value)
          WHERE COALESCE(m.value->>'component_id', '') = ''
            AND m.key NOT IN ('profile', 'supports', 'endCaps', 'strip')) AS unknown_hardware_keys,
        ARRAY(SELECT pos FROM unnest(ARRAY['top', 'between']::TEXT[]) AS pos
               WHERE pos = ANY (p.compatible_placements)) AS v2_positions,
        ARRAY(SELECT pl FROM unnest(p.compatible_placements) AS pl
               WHERE pl NOT IN ('top', 'between')) AS dropped_placements,
        CASE
            WHEN p.door_reduction_mm IS NOT NULL AND p.door_reduction_mm > 0 THEN 'door_reduction_mm'
            WHEN p.door_reduction_mm IS NULL
             AND p.front_reduction_mm IS NOT NULL AND p.front_reduction_mm > 0
             AND p.grip_clearance_mm IS NOT NULL AND p.grip_clearance_mm >= 0
                THEN 'front_reduction_mm+grip_clearance_mm'
            ELSE 'missing'
        END AS discount_source
    FROM opening_profiles p
    WHERE p.v2_migration IS NULL
      AND p.grip_type = 'gola'
),
planned AS (
    SELECT
        s.*,
        CASE WHEN COALESCE(array_length(s.component_keys, 1), 0) > 0 THEN 'melamine' ELSE 'aluminum' END AS v2_material,
        CASE
            WHEN NOT ('top' = ANY (s.v2_positions)) THEN NULL
            WHEN s.discount_source = 'door_reduction_mm' THEN p.door_reduction_mm
            WHEN s.discount_source = 'front_reduction_mm+grip_clearance_mm' THEN p.front_reduction_mm + p.grip_clearance_mm
            ELSE NULL
        END AS v2_top_discount,
        COALESCE(array_length(s.v2_positions, 1), 0) = 0 AS no_position,
        CASE
            WHEN COALESCE(array_length(s.component_keys, 1), 0) = 1
             AND (s.component_keys[1] = 'strip' OR NOT (p.bom_members ? 'strip'))
                THEN s.component_keys[1]
            ELSE NULL
        END AS strip_from_key,
        p.active AS was_active
    FROM source s
    JOIN opening_profiles p ON p.id = s.id
)
UPDATE opening_profiles p
SET material = pl.v2_material,
    positions = pl.v2_positions,
    front_discount_top_mm = pl.v2_top_discount,
    bom_members = CASE
        WHEN pl.strip_from_key IS NULL THEN p.bom_members
        ELSE (p.bom_members - pl.strip_from_key)
             || jsonb_build_object('strip',
                    CASE WHEN (p.bom_members->pl.strip_from_key) ? 'height_mm'
                         THEN p.bom_members->pl.strip_from_key
                         ELSE (p.bom_members->pl.strip_from_key) || '{"height_mm": 70}'::jsonb
                    END)
    END,
    active = CASE WHEN pl.no_position THEN FALSE ELSE p.active END,
    v2_migration = jsonb_strip_nulls(jsonb_build_object(
        'migration', '000180',
        'issue', 1530,
        'action', CASE WHEN pl.no_position THEN 'deactivated' ELSE 'converted' END,
        'reason', CASE WHEN pl.no_position THEN 'no_v2_position' END,
        'was_active', pl.was_active,
        'material', pl.v2_material,
        'positions', to_jsonb(pl.v2_positions),
        'dropped_placements', CASE WHEN COALESCE(array_length(pl.dropped_placements, 1), 0) > 0
                                   THEN to_jsonb(pl.dropped_placements) END,
        'front_discount_top_mm', pl.v2_top_discount,
        'discount_source', CASE WHEN 'top' = ANY (pl.v2_positions) THEN pl.discount_source END,
        'front_discount_between_mm', CASE WHEN 'between' = ANY (pl.v2_positions) THEN 'missing' END,
        'strip_renamed_from', CASE WHEN pl.strip_from_key IS NOT NULL AND pl.strip_from_key <> 'strip'
                                   THEN pl.strip_from_key END,
        'strip_height_default_mm', CASE WHEN pl.strip_from_key IS NOT NULL
                                         AND NOT ((p.bom_members->pl.strip_from_key) ? 'height_mm')
                                        THEN 70 END,
        'unassigned_component_keys', CASE WHEN COALESCE(array_length(pl.component_keys, 1), 0) > 0
                                           AND pl.strip_from_key IS NULL
                                          THEN to_jsonb(pl.component_keys) END,
        'unknown_member_roles', CASE WHEN COALESCE(array_length(pl.unknown_hardware_keys, 1), 0) > 0
                                     THEN to_jsonb(pl.unknown_hardware_keys) END
    )),
    version = p.version + 1,
    updated_at = NOW()
FROM planned pl
WHERE p.id = pl.id;
