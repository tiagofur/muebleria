-- #1532 (ADR-0009 Amendment 1 A2.3/A5/A7; opening-front-system.md §14.3/§14.8/§14.9):
-- project grip with per-furniture overrides and complete frozen snapshots.
-- The project picks one grip style; every furniture inherits it; a furniture
-- may carry an override. Applying freezes ONE complete snapshot (A7) — later
-- workshop edits never change an existing project until the explicit,
-- audited «Actualizar a los valores actuales del taller».
--
-- This migration also converts every persisted DesignOpeningSelection
-- (design_working_copies.authoring_defaults -> 'opening') into per-furniture
-- override snapshots and assigns the organization's default style to every
-- project, with a per-row report in design_working_copies.opening_migration
-- (the original selection rides in the report, so the down migration
-- restores it verbatim). authoring_defaults itself is NOT rewritten:
-- published revisions are immutable and the column becomes dead data the
-- new code paths never read.
--
-- Concurrency token: projects.grip_version gates every project-grip write
-- with If-Match (style change, batch overrides, refresh).

-- grip_version starts at 1: the token must be expressible as If-Match
-- ("v0" is not a strong ETag the API accepts), so a brand-new project is
-- already at its first grip revision.
ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS grip_style_id UUID REFERENCES grip_styles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS grip_snapshot JSONB,
    ADD COLUMN IF NOT EXISTS grip_version BIGINT NOT NULL DEFAULT 1;

ALTER TABLE furniture_instances
    ADD COLUMN IF NOT EXISTS grip_snapshot JSONB;

ALTER TABLE design_working_copies
    ADD COLUMN IF NOT EXISTS opening_migration JSONB;

CREATE INDEX IF NOT EXISTS idx_projects_grip_style ON projects(grip_style_id);

-- freeze_live_profile(#1532): one frozen-profile JSONB from a live
-- opening_profiles row — the exact copy FreezeGripSnapshot writes.
CREATE OR REPLACE FUNCTION migration_000182_freeze_live_profile(profile_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
DECLARE
    p opening_profiles;
BEGIN
    IF profile_id IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT * INTO p FROM opening_profiles WHERE id = profile_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    RETURN jsonb_build_object(
        'profileId', p.id,
        'code', p.code,
        'name', p.name,
        'material', p.material,
        'positions', to_jsonb(p.positions),
        'profileHeightMm', p.profile_height_mm,
        'profileDepthMm', p.profile_depth_mm,
        'frontDiscountTopMm', p.front_discount_top_mm,
        'frontDiscountBetweenMm', p.front_discount_between_mm,
        'compatiblePlacements', to_jsonb(p.compatible_placements),
        'bodyModifiers', p.body_modifiers,
        'bomMembers', p.bom_members,
        'bomVersion', p.version
    );
END $$;

-- freeze_style_snapshot(#1532): one GripSnapshot JSONB from a grip_styles row.
CREATE OR REPLACE FUNCTION migration_000182_freeze_style_snapshot(style grip_styles)
RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
DECLARE
    result JSONB;
    ftype TEXT;
    recipe JSONB;
    recipes JSONB := '{}'::jsonb;
BEGIN
    FOREACH ftype IN ARRAY ARRAY['inferior', 'superior', 'alto'] LOOP
        recipe := style.by_furniture_type -> ftype;
        IF recipe ->> 'mode' = 'gola' THEN
            recipe := jsonb_build_object(
                'mode', 'gola',
                'handleHardwareId', recipe -> 'handleHardwareId',
                'top', migration_000182_freeze_live_profile((recipe ->> 'topProfileId')::uuid),
                'between', migration_000182_freeze_live_profile((recipe ->> 'betweenProfileId')::uuid)
            );
        ELSE
            recipe := jsonb_build_object(
                'mode', recipe ->> 'mode',
                'handleHardwareId', recipe -> 'handleHardwareId',
                'overhangMm', recipe -> 'overhangMm'
            );
        END IF;
        recipes := recipes || jsonb_build_object(ftype, recipe);
    END LOOP;
    result := jsonb_build_object(
        'styleId', style.id,
        'styleName', style.name,
        'recipes', recipes,
        'frozenAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );
    RETURN result;
END $$;

-- project_org(#1532): the organization of a project.
CREATE OR REPLACE FUNCTION migration_000182_project_org(p_project_id UUID)
RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT organization_id FROM projects WHERE id = p_project_id
$$;

-- overhang_rule(#1532): the v1 bottom_overhang millimetres a migrated
-- selection resolves with — the same precedence OpeningOverhangRuleFromGripStyles
-- serves (#1531): the default style's overhang (superior → inferior → alto),
-- then the first offered style's, then the owner's 20 mm.
CREATE OR REPLACE FUNCTION migration_000182_overhang_rule(p_org_id UUID)
RETURNS NUMERIC LANGUAGE plpgsql STABLE AS $$
DECLARE
    style grip_styles;
    ftype TEXT;
BEGIN
    SELECT * INTO style FROM grip_styles
     WHERE organization_id = p_org_id AND is_default LIMIT 1;
    IF FOUND THEN
        FOREACH ftype IN ARRAY ARRAY['superior', 'inferior', 'alto'] LOOP
            IF style.by_furniture_type #>> ARRAY[ftype, 'mode'] = 'bottom_overhang'
               AND style.by_furniture_type #>> ARRAY[ftype, 'overhangMm'] IS NOT NULL THEN
                RETURN (style.by_furniture_type #>> ARRAY[ftype, 'overhangMm'])::numeric;
            END IF;
        END LOOP;
    END IF;
    SELECT * INTO style FROM grip_styles
     WHERE organization_id = p_org_id AND offered
     ORDER BY created_at, id LIMIT 1;
    IF FOUND THEN
        FOREACH ftype IN ARRAY ARRAY['superior', 'inferior', 'alto'] LOOP
            IF style.by_furniture_type #>> ARRAY[ftype, 'mode'] = 'bottom_overhang'
               AND style.by_furniture_type #>> ARRAY[ftype, 'overhangMm'] IS NOT NULL THEN
                RETURN (style.by_furniture_type #>> ARRAY[ftype, 'overhangMm'])::numeric;
            END IF;
        END LOOP;
    END IF;
    RETURN 20;
END $$;

DO $$
DECLARE
    org UUID;
    dstyle grip_styles;
    proj RECORD;
    wc RECORD;
    item RECORD;
    sel JSONB;
    pin JSONB;
    system TEXT;
    recipe JSONB;
    recipes JSONB;
    snap JSONB;
    frozen JSONB;
    ftype TEXT;
    discount NUMERIC;
    inst_reports JSONB;
    bottom_gola BOOLEAN;
    pin_source TEXT;
    absent JSONB;
    any_row BOOLEAN := FALSE;
BEGIN
    -- 1. Every project takes its organization's default style, frozen (A7).
    FOR proj IN SELECT id FROM projects ORDER BY id LOOP
        org := migration_000182_project_org(proj.id);
        IF org IS NULL THEN
            UPDATE projects SET grip_version = 1 WHERE id = proj.id;
            CONTINUE;
        END IF;
        SELECT * INTO dstyle FROM grip_styles
         WHERE organization_id = org AND is_default LIMIT 1;
        IF NOT FOUND THEN
            -- 000181 guarantees exactly one default per organization; an
            -- org without one keeps no project grip (resolve = no grip).
            UPDATE projects SET grip_version = 1 WHERE id = proj.id;
            CONTINUE;
        END IF;
        UPDATE projects
           SET grip_style_id = dstyle.id,
               grip_snapshot = migration_000182_freeze_style_snapshot(dstyle),
               grip_version = 1
         WHERE id = proj.id;
    END LOOP;

    -- 2. Every persisted DesignOpeningSelection becomes per-furniture
    --    override snapshots, with a per-row report.
    FOR wc IN SELECT design_id, organization_id, project_id,
                     authoring_defaults -> 'opening' AS sel
                FROM design_working_copies
               WHERE authoring_defaults -> 'opening' IS NOT NULL
                 AND jsonb_typeof(authoring_defaults -> 'opening') = 'object'
               ORDER BY design_id LOOP
        any_row := TRUE;
        sel := wc.sel;
        system := sel ->> 'system';
        pin := sel -> 'profilePin';
        pin_source := CASE WHEN pin IS NOT NULL THEN 'pin' ELSE 'live_catalog' END;
        inst_reports := '[]'::jsonb;

        FOR item IN
            SELECT dwi.furniture_instance_id,
                   COALESCE(NULLIF(m.furniture_type, ''), 'inferior') AS ftype
              FROM design_working_items dwi
              JOIN furniture_instances fi ON fi.id = dwi.furniture_instance_id
              LEFT JOIN modules m ON m.id = fi.furniture_definition_id
             WHERE dwi.design_id = wc.design_id
             ORDER BY dwi.furniture_instance_id
        LOOP
            absent := '[]'::jsonb;
            bottom_gola := FALSE;
            IF system = 'gola' THEN
                IF pin IS NOT NULL THEN
                    discount := COALESCE(
                        (pin ->> 'doorReductionMm')::numeric,
                        ((pin ->> 'frontReductionMm')::numeric
                         + (pin ->> 'gripClearanceMm')::numeric));
                    frozen := jsonb_build_object(
                        'profileId', sel ->> 'profileId',
                        'code', pin ->> 'profileCode',
                        'name', pin ->> 'profileCode',
                        'positions', COALESCE(pin -> 'compatiblePlacements', '[]'::jsonb),
                        'profileHeightMm', NULLIF(pin ->> 'profileHeightMm', '')::numeric,
                        'profileDepthMm', NULLIF(pin ->> 'profileDepthMm', '')::numeric,
                        'frontDiscountTopMm', discount,
                        'frontDiscountBetweenMm', NULL::numeric,
                        'compatiblePlacements', COALESCE(pin -> 'compatiblePlacements', '[]'::jsonb),
                        'bodyModifiers', COALESCE(pin -> 'bodyModifiers', '[]'::jsonb),
                        'bomMembers', COALESCE(pin #> '{bom,members}', '{}'::jsonb),
                        'bomVersion', COALESCE(pin #>> '{bom,profileVersion}', '0')::numeric
                    );
                    IF pin ->> 'profileHeightMm' IS NULL THEN
                        absent := absent || '["profileHeightMm"]'::jsonb;
                    END IF;
                    IF pin ->> 'profileDepthMm' IS NULL THEN
                        absent := absent || '["profileDepthMm"]'::jsonb;
                    END IF;
                    IF pin -> 'bom' IS NULL THEN
                        absent := absent || '["bom"]'::jsonb;
                    END IF;
                ELSE
                    frozen := migration_000182_freeze_live_profile((sel ->> 'profileId')::uuid);
                END IF;
                -- A v1 bottom gola has no A3 equivalent (§14.4.1): the recipe
                -- freezes with the flag and the resolve blocks with the
                -- honest code — never a silent reinterpretation as top.
                IF sel -> 'placements' ? 'bottom' THEN
                    bottom_gola := TRUE;
                END IF;
                recipe := jsonb_build_object(
                    'mode', 'gola',
                    'top', frozen,
                    'between', NULL::jsonb,
                    'legacyBottomGola', CASE WHEN bottom_gola THEN TRUE END
                );
            ELSIF system = 'bottom_overhang' THEN
                recipe := jsonb_build_object(
                    'mode', 'bottom_overhang',
                    'overhangMm', migration_000182_overhang_rule(wc.organization_id)
                );
            ELSE
                recipe := jsonb_build_object('mode', 'handle');
            END IF;
            recipes := jsonb_build_object(item.ftype, recipe);
            snap := jsonb_build_object(
                'styleId', NULL::text,
                'styleName', 'Selección de apertura migrada',
                'recipes', recipes,
                'frozenAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
            );
            UPDATE furniture_instances
               SET grip_snapshot = snap
             WHERE id = item.furniture_instance_id;
            inst_reports := inst_reports || jsonb_build_object(
                'furnitureInstanceId', item.furniture_instance_id,
                'furnitureType', item.ftype,
                'action', CASE WHEN system = 'handle' THEN 'override_handle' ELSE 'override_frozen' END,
                'recipeMode', system,
                'legacyBottomGola', CASE WHEN bottom_gola THEN TRUE END
            );
        END LOOP;

        UPDATE design_working_copies
           SET opening_migration = jsonb_build_object(
                   'migration', '000182',
                   'issue', 1532,
                   'action', CASE WHEN system = 'handle' THEN 'handle_override' ELSE 'selection_frozen' END,
                   'system', system,
                   'pinSource', pin_source,
                   'legacyBottomGola', CASE WHEN bottom_gola THEN TRUE END,
                   'absent', absent,
                   'selection', sel,
                   'instances', inst_reports
               )
         WHERE design_id = wc.design_id;
    END LOOP;

    IF NOT any_row THEN
        RAISE NOTICE '000182: no persisted opening selections to migrate';
    END IF;
END $$;

DROP FUNCTION IF EXISTS migration_000182_freeze_live_profile(UUID);
DROP FUNCTION IF EXISTS migration_000182_freeze_style_snapshot(grip_styles);
DROP FUNCTION IF EXISTS migration_000182_project_org(UUID);
DROP FUNCTION IF EXISTS migration_000182_overhang_rule(UUID);
