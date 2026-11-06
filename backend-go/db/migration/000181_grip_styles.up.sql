-- #1531 (ADR-0009 Amendment 1, A2.2/A4/A5; opening-front-system.md §14.3/§14.9):
-- grip styles. A workshop-owned, named recipe per furniture type
-- (inferior | superior | alto) with one mode each:
--   handle          { "mode": "handle", "handleHardwareId": <hardware id or null> }
--   gola            { "mode": "gola", "topProfileId": <id>, "betweenProfileId": <id or null> }
--   bottom_overhang { "mode": "bottom_overhang", "overhangMm": <int > 0> }
-- Exactly one default per organization (partial unique index + the API never
-- leaves an organization without one). Replaces the overlay blobs
-- `opening.capabilities` and `opening.bottom-overhang`, which this migration
-- converts (with a per-row report in `migration_report`) and then removes.

CREATE TABLE IF NOT EXISTS grip_styles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
    offered BOOLEAN NOT NULL DEFAULT TRUE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    by_furniture_type JSONB NOT NULL
        CHECK (jsonb_typeof(by_furniture_type) = 'object'
               AND by_furniture_type ?& ARRAY['inferior', 'superior', 'alto']),
    migration_report JSONB,
    version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT grip_styles_org_name_unique UNIQUE (organization_id, name),
    -- A default style is always offered (available ≠ valid, but the default
    -- must be choosable).
    CONSTRAINT grip_styles_default_is_offered CHECK (NOT is_default OR offered)
);

CREATE INDEX IF NOT EXISTS idx_grip_styles_organization ON grip_styles(organization_id, name);
-- At most one default per organization, enforced by the database (also under
-- concurrent writes: the second writer hits the unique violation).
CREATE UNIQUE INDEX IF NOT EXISTS grip_styles_one_default_per_org
    ON grip_styles(organization_id) WHERE is_default;

ALTER TABLE grip_styles ENABLE ROW LEVEL SECURITY;
ALTER TABLE grip_styles FORCE ROW LEVEL SECURITY;

CREATE POLICY grip_styles_read ON grip_styles
    FOR SELECT TO granete_app
    USING (organization_id = app_current_organization_id());

CREATE POLICY grip_styles_insert ON grip_styles
    FOR INSERT TO granete_app
    WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY grip_styles_update ON grip_styles
    FOR UPDATE TO granete_app
    USING (organization_id = app_current_organization_id())
    WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY grip_styles_delete ON grip_styles
    FOR DELETE TO granete_app
    USING (organization_id = app_current_organization_id());

INSERT INTO rls_policy_inventory
    (table_name, classification, read_scope, write_scope, rationale)
VALUES
    ('grip_styles', 'tenant-owned', 'current-organization', 'current-organization',
     'Workshop grip styles (#1531 / ADR-0009 A2.2): named per-furniture-type grip recipes of one organization; no cross-tenant sharing')
ON CONFLICT (table_name) DO UPDATE SET
    classification = EXCLUDED.classification,
    read_scope = EXCLUDED.read_scope,
    write_scope = EXCLUDED.write_scope,
    rationale = EXCLUDED.rationale,
    policy_version = rls_policy_inventory.policy_version + 1,
    updated_at = NOW();

GRANT SELECT, INSERT, UPDATE, DELETE ON grip_styles TO granete_app;

-- Seed for new organizations: «Jaladera» as the default style.
CREATE OR REPLACE FUNCTION initialize_organization_grip_styles()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    INSERT INTO grip_styles (organization_id, name, offered, is_default, by_furniture_type)
    VALUES (NEW.id, 'Jaladera', TRUE, TRUE,
            '{"inferior":{"mode":"handle"},"superior":{"mode":"handle"},"alto":{"mode":"handle"}}'::jsonb)
    ON CONFLICT (organization_id, name) DO NOTHING;
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS initialize_organization_grip_styles ON organizations;
CREATE TRIGGER initialize_organization_grip_styles
AFTER INSERT ON organizations FOR EACH ROW EXECUTE FUNCTION initialize_organization_grip_styles();
REVOKE ALL ON FUNCTION initialize_organization_grip_styles() FROM PUBLIC;

-- Backfill and blob conversion for existing organizations.
DO $$
DECLARE
    org RECORD;
    overlay_id UUID;
    overlay_overrides JSONB;
    caps JSONB;
    rule JSONB;
    overhang_mm INTEGER;
    overhang_source TEXT;
    ftype TEXT;
    sys TEXT;
    recipe JSONB;
    recipes JSONB;
    type_reports JSONB;
    any_non_handle BOOLEAN;
    top_profile TEXT;
    between_profile TEXT;
    candidate TEXT;
    report JSONB;
BEGIN
    FOR org IN SELECT id FROM organizations LOOP
        caps := NULL;
        rule := NULL;
        overlay_id := NULL;
        overlay_overrides := NULL;
        SELECT lo.id, lo.overrides INTO overlay_id, overlay_overrides
          FROM library_overlays lo
         WHERE lo.organization_id = org.id
           AND lo.status = 'active'
           AND (lo.overrides ? 'opening.capabilities' OR lo.overrides ? 'opening.bottom-overhang')
         ORDER BY lo.updated_at DESC
         LIMIT 1;
        IF overlay_id IS NOT NULL THEN
            caps := overlay_overrides -> 'opening.capabilities';
            rule := overlay_overrides -> 'opening.bottom-overhang';
        END IF;

        overhang_mm := 20;
        overhang_source := 'default_a4';
        IF rule IS NOT NULL AND jsonb_typeof(rule -> 'overhangMm') = 'number'
           AND (rule ->> 'overhangMm')::numeric > 0
           AND (rule ->> 'overhangMm')::numeric = trunc((rule ->> 'overhangMm')::numeric) THEN
            overhang_mm := (rule ->> 'overhangMm')::integer;
            overhang_source := 'opening.bottom-overhang';
        END IF;

        -- The «Jaladera» style is always seeded. It is the default unless
        -- the blobs declared another system as the workshop default.
        INSERT INTO grip_styles (organization_id, name, offered, is_default, by_furniture_type)
        VALUES (org.id, 'Jaladera', TRUE, FALSE,
                '{"inferior":{"mode":"handle"},"superior":{"mode":"handle"},"alto":{"mode":"handle"}}'::jsonb)
        ON CONFLICT (organization_id, name) DO NOTHING;

        recipes := '{}'::jsonb;
        type_reports := '{}'::jsonb;
        any_non_handle := FALSE;
        IF caps IS NOT NULL THEN
            FOREACH ftype IN ARRAY ARRAY['inferior', 'superior', 'alto'] LOOP
                -- The system the factory declared as default for this type
                -- (per-type default first, then the global default).
                sys := NULL;
                SELECT key INTO sys
                  FROM jsonb_each(COALESCE(caps -> 'byFurnitureType' -> ftype -> 'grips', '{}'::jsonb))
                 WHERE (value ->> 'default')::boolean IS TRUE
                 LIMIT 1;
                IF sys IS NULL THEN
                    SELECT key INTO sys
                      FROM jsonb_each(COALESCE(caps -> 'grips', '{}'::jsonb))
                     WHERE (value ->> 'default')::boolean IS TRUE
                     LIMIT 1;
                END IF;
                sys := COALESCE(sys, 'handle');

                IF sys = 'gola' THEN
                    -- The standard L profile, else the first curated one,
                    -- usable at the top (active, height, depth, top discount).
                    top_profile := NULL;
                    FOR candidate IN
                        SELECT c FROM (
                            SELECT caps -> 'grips' -> 'gola' -> 'standardProfiles' ->> 'L' AS c, 0 AS ord
                            UNION ALL
                            SELECT jsonb_array_elements_text(COALESCE(caps -> 'grips' -> 'gola' -> 'profiles', '[]'::jsonb)), 1
                        ) x WHERE c IS NOT NULL ORDER BY ord
                    LOOP
                        IF EXISTS (SELECT 1 FROM opening_profiles p
                                    WHERE p.id = candidate AND p.organization_id = org.id AND p.active
                                      AND 'top' = ANY (p.positions)
                                      AND p.profile_height_mm IS NOT NULL AND p.profile_depth_mm IS NOT NULL
                                      AND p.front_discount_top_mm IS NOT NULL) THEN
                            top_profile := candidate;
                            EXIT;
                        END IF;
                    END LOOP;
                    between_profile := NULL;
                    candidate := caps -> 'grips' -> 'gola' -> 'standardProfiles' ->> 'C';
                    IF candidate IS NOT NULL AND EXISTS (
                        SELECT 1 FROM opening_profiles p
                         WHERE p.id = candidate AND p.organization_id = org.id AND p.active
                           AND 'between' = ANY (p.positions)
                           AND p.profile_height_mm IS NOT NULL AND p.profile_depth_mm IS NOT NULL
                           AND p.front_discount_between_mm IS NOT NULL) THEN
                        between_profile := candidate;
                    END IF;
                    IF top_profile IS NULL THEN
                        recipe := '{"mode":"handle"}'::jsonb;
                        type_reports := type_reports || jsonb_build_object(ftype,
                            jsonb_build_object('declared', 'gola', 'converted', 'handle', 'reason', 'no_usable_top_profile'));
                    ELSE
                        recipe := jsonb_strip_nulls(jsonb_build_object(
                            'mode', 'gola', 'topProfileId', top_profile, 'betweenProfileId', between_profile));
                        any_non_handle := TRUE;
                        type_reports := type_reports || jsonb_build_object(ftype,
                            jsonb_strip_nulls(jsonb_build_object('declared', 'gola', 'converted', 'gola',
                                'topProfileId', top_profile, 'betweenProfileId', between_profile)));
                    END IF;
                ELSIF sys = 'bottom_overhang' THEN
                    recipe := jsonb_build_object('mode', 'bottom_overhang', 'overhangMm', overhang_mm);
                    any_non_handle := TRUE;
                    type_reports := type_reports || jsonb_build_object(ftype,
                        jsonb_build_object('declared', 'bottom_overhang', 'converted', 'bottom_overhang',
                            'overhangMm', overhang_mm, 'overhangSource', overhang_source));
                ELSE
                    recipe := '{"mode":"handle"}'::jsonb;
                    type_reports := type_reports || jsonb_build_object(ftype,
                        jsonb_build_object('declared', sys, 'converted', 'handle'));
                END IF;
                recipes := recipes || jsonb_build_object(ftype, recipe);
            END LOOP;
        END IF;

        report := jsonb_strip_nulls(jsonb_build_object(
            'migration', '000181',
            'issue', 1531,
            'overlayId', overlay_id,
            'capabilities', caps,
            'bottomOverhang', rule,
            'byFurnitureType', type_reports));

        IF caps IS NOT NULL AND any_non_handle THEN
            INSERT INTO grip_styles (organization_id, name, offered, is_default, by_furniture_type, migration_report)
            VALUES (org.id, 'Agarre del taller (migrado)', TRUE, TRUE, recipes,
                    report || '{"action":"converted"}'::jsonb)
            ON CONFLICT (organization_id, name) DO NOTHING;
        ELSIF rule IS NOT NULL THEN
            -- The overhang value existed without being the default anywhere:
            -- keep it as an offered style so the number is not lost.
            INSERT INTO grip_styles (organization_id, name, offered, is_default, by_furniture_type, migration_report)
            VALUES (org.id, 'Rebase (migrado)', TRUE, FALSE,
                    jsonb_build_object('inferior', '{"mode":"handle"}'::jsonb,
                                       'superior', jsonb_build_object('mode', 'bottom_overhang', 'overhangMm', overhang_mm),
                                       'alto', '{"mode":"handle"}'::jsonb),
                    report || '{"action":"converted_overhang_only"}'::jsonb)
            ON CONFLICT (organization_id, name) DO NOTHING;
        END IF;

        -- Exactly one default: «Jaladera» unless a converted style took it.
        IF NOT EXISTS (SELECT 1 FROM grip_styles WHERE organization_id = org.id AND is_default) THEN
            UPDATE grip_styles SET is_default = TRUE
             WHERE organization_id = org.id AND name = 'Jaladera';
        END IF;
        IF caps IS NOT NULL OR rule IS NOT NULL THEN
            UPDATE grip_styles
               SET migration_report = COALESCE(migration_report, report || '{"action":"seeded"}'::jsonb)
             WHERE organization_id = org.id AND name = 'Jaladera';
        END IF;
    END LOOP;
END $$;

-- The blobs are retired: their content lives in the styles and in each
-- converted style's migration_report.
UPDATE library_overlays
   SET overrides = overrides - 'opening.capabilities' - 'opening.bottom-overhang',
       version = version + 1,
       updated_at = NOW()
 WHERE overrides ? 'opening.capabilities' OR overrides ? 'opening.bottom-overhang';
