// Organization, membership and security-audit persistence (ADR-0004 / #325).

package storage

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// InitialOrganizationID is the deterministic id of the organization created by
// the multi-org backfill (migration 000081) from the former single-workshop
// deployment. While only one organization exists, approval and role bridges
// target it explicitly.
const InitialOrganizationID = "00000000-0000-0000-0000-000000000001"

var (
	ErrMembershipNotFound         = errors.New("membership not found")
	ErrOrganizationNotFound       = errors.New("organization not found")
	ErrSupportSessionNotFound     = errors.New("support session not found")
	ErrVersionConflict            = errors.New("resource version conflict")
	ErrOrganizationStatusConflict = errors.New("organization status conflict")
)

const organizationColumns = `id, name, slug, type, license_plan, license_expires_at,
	status, credential_version, status_changed_at, status_changed_by::text,
	status_reason, suspended_at, offboarding_started_at, terminated_at,
	parent_organization_id, created_at, updated_at, version`

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func scanOrganization(row pgx.Row) (*domain.Organization, error) {
	var o domain.Organization
	err := row.Scan(&o.ID, &o.Name, &o.Slug, &o.Type, &o.LicensePlan, &o.LicenseExpiresAt,
		&o.Status, &o.CredentialVersion, &o.StatusChangedAt, &o.StatusChangedBy,
		&o.StatusReason, &o.SuspendedAt, &o.OffboardingStartedAt, &o.TerminatedAt,
		&o.ParentOrganizationID, &o.CreatedAt, &o.UpdatedAt, &o.Version)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("organization not found")
		}
		return nil, err
	}
	return &o, nil
}

func (s *PostgresStore) GetOrganizationByID(ctx context.Context, id string) (*domain.Organization, error) {
	return scanOrganization(s.db(ctx).QueryRow(ctx,
		`SELECT `+organizationColumns+` FROM organizations WHERE id = $1`, id))
}

func (s *PostgresStore) GetOrganizationBySlug(ctx context.Context, slug string) (*domain.Organization, error) {
	return scanOrganization(s.db(ctx).QueryRow(ctx,
		`SELECT `+organizationColumns+` FROM organizations WHERE slug = $1`, slug))
}

func (s *PostgresStore) ListOrganizations(ctx context.Context) ([]domain.Organization, error) {
	rows, err := s.db(ctx).Query(ctx, `SELECT `+organizationColumns+` FROM organizations ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Organization{}
	for rows.Next() {
		var o domain.Organization
		if err := rows.Scan(&o.ID, &o.Name, &o.Slug, &o.Type, &o.LicensePlan, &o.LicenseExpiresAt,
			&o.Status, &o.CredentialVersion, &o.StatusChangedAt, &o.StatusChangedBy,
			&o.StatusReason, &o.SuspendedAt, &o.OffboardingStartedAt, &o.TerminatedAt,
			&o.ParentOrganizationID, &o.CreatedAt, &o.UpdatedAt, &o.Version); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// CreateOrganization inserts a new organization. Catalog cloning is a service
// concern (F172); this only writes the identity row.
func (s *PostgresStore) CreateOrganization(ctx context.Context, o *domain.Organization) error {
	if o.Type == "" {
		o.Type = domain.OrganizationTypeFactory
	}
	plan := o.LicensePlan
	if plan == "" {
		plan = domain.LicensePlanNone
	}
	status := o.Status
	if status == "" {
		status = domain.OrganizationStatusProvisioning
	}
	if !domain.IsValidOrganizationStatus(status) {
		return fmt.Errorf("invalid organization status")
	}
	statusChangedBy := stringValue(o.StatusChangedBy)
	actor, hasActor := TenantActorFromCtx(ctx)
	if statusChangedBy == "" && hasActor && actor.UserID != "" {
		statusChangedBy = actor.UserID
	}
	err := s.db(ctx).QueryRow(ctx, `
		SELECT `+organizationColumns+`
		FROM command_create_organization(
			$1, $2, $3, $4, $5, $6, $7, nullif($8, '')::uuid, $9
		)`,
		o.Name, o.Slug, o.Type, plan, o.LicenseExpiresAt, status, stringValue(o.StatusReason), statusChangedBy, o.ParentOrganizationID).
		Scan(&o.ID, &o.Name, &o.Slug, &o.Type, &o.LicensePlan, &o.LicenseExpiresAt,
			&o.Status, &o.CredentialVersion, &o.StatusChangedAt, &o.StatusChangedBy,
			&o.StatusReason, &o.SuspendedAt, &o.OffboardingStartedAt, &o.TerminatedAt,
			&o.ParentOrganizationID, &o.CreatedAt, &o.UpdatedAt, &o.Version)
	if err != nil {
		return err
	}
	// The database command validated the caller and parent before insertion.
	// Extend only this transaction's exact scope: platform gets the new child;
	// Factory keeps its source plus the one child it just created.
	if hasActor && actor.UserID != "" {
		if actor.OrganizationID == "" {
			return authorizeTenantOrganizations(ctx, o.ID)
		}
		if o.ParentOrganizationID != nil && *o.ParentOrganizationID == actor.OrganizationID {
			return authorizeTenantOrganizations(ctx, actor.OrganizationID, o.ID)
		}
	}
	return nil
}

// ListConnectedOrganizations returns the sales network of a factory: the
// organizations whose parent is the given factory (#326).
func (s *PostgresStore) ListConnectedOrganizations(ctx context.Context, parentOrganizationID string) ([]domain.Organization, error) {
	rows, err := s.db(ctx).Query(ctx,
		`SELECT `+organizationColumns+` FROM organizations WHERE parent_organization_id = $1 ORDER BY created_at`,
		parentOrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Organization{}
	for rows.Next() {
		var o domain.Organization
		if err := rows.Scan(&o.ID, &o.Name, &o.Slug, &o.Type, &o.LicensePlan, &o.LicenseExpiresAt,
			&o.Status, &o.CredentialVersion, &o.StatusChangedAt, &o.StatusChangedBy,
			&o.StatusReason, &o.SuspendedAt, &o.OffboardingStartedAt, &o.TerminatedAt,
			&o.ParentOrganizationID, &o.CreatedAt, &o.UpdatedAt, &o.Version); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

const membershipWithOrgColumns = `
	m.id, m.organization_id, m.user_id, m.roles, m.status, m.joined_at, m.suspended_at, m.suspended_by::text, m.suspension_reason, m.left_at, m.left_by::text, m.leave_reason, m.created_at, m.updated_at, m.version, m.credential_version, m.sessions_revoked_at,
	o.id, o.name, o.slug, o.type, o.license_plan, o.license_expires_at,
	o.status, o.credential_version, o.status_changed_at, o.status_changed_by::text,
	o.status_reason, o.suspended_at, o.offboarding_started_at, o.terminated_at,
	o.parent_organization_id, o.created_at, o.updated_at, o.version`

func jsonbRemapKey(col, key, mapTable string) string {
	return fmt.Sprintf(`CASE WHEN s.%[1]s IS NULL THEN NULL ELSE COALESCE((
		SELECT jsonb_agg(jsonb_set(el, '{%[2]s}',
			COALESCE((SELECT to_jsonb(mt.new_id::text) FROM %[3]s mt WHERE mt.old_id::text = el->>'%[2]s'), el->'%[2]s')))
		FROM jsonb_array_elements(s.%[1]s) el), '[]'::jsonb) END`, col, key, mapTable)
}

func jsonbRemapParameterDefinitionComponents(col, mapTable string) string {
	return fmt.Sprintf(`CASE WHEN s.%[1]s IS NULL THEN NULL ELSE COALESCE((
		SELECT jsonb_agg(
			CASE WHEN definition #> '{binding,componentId}' IS NULL THEN remapped_targets
			ELSE jsonb_set(remapped_targets, '{binding,componentId}', to_jsonb(component_map.new_id::text)) END
			ORDER BY definition_ordinality)
		FROM jsonb_array_elements(s.%[1]s) WITH ORDINALITY AS definitions(definition, definition_ordinality)
		LEFT JOIN %[2]s component_map ON component_map.old_id::text = definition #>> '{binding,componentId}'
		CROSS JOIN LATERAL (
			SELECT CASE WHEN jsonb_typeof(definition #> '{binding,relationship,targets}') = 'array'
				THEN jsonb_set(definition, '{binding,relationship,targets}', COALESCE((
					SELECT jsonb_agg(jsonb_set(target, '{componentId}', to_jsonb(target_map.new_id::text)) ORDER BY target_ordinality)
					FROM jsonb_array_elements(definition #> '{binding,relationship,targets}') WITH ORDINALITY AS targets(target, target_ordinality)
					JOIN %[2]s target_map ON target_map.old_id::text = target->>'componentId'
				), '[]'::jsonb))
				ELSE definition END AS remapped_targets
		) remapped
	), '[]'::jsonb) END`, col, mapTable)
}

// CloneCatalog copies an organization's entire catalog (categories, boards,
// edges, hardwares, components, agregados, option groups, structures,
// modules + children) into a destination organization with fresh UUIDs and
// full FK/JSONB id remapping (ADR-0005 §4: cloned catalogs, every row owned).
// structure_revisions history is intentionally NOT cloned — the current
// revision travels with the structures row.
func (s *PostgresStore) CloneCatalog(ctx context.Context, srcOrg, dstOrg string) error {
	tx, owned, err := s.beginOrUseTx(ctx)
	if err != nil {
		return err
	}
	if owned {
		defer tx.Rollback(ctx)
		ctx = context.WithValue(ctx, transactionContextKey{}, tx)
	}
	if err := authorizeTenantOrganizations(ctx, srcOrg, dstOrg); err != nil {
		return err
	}

	maps := []struct{ name, table string }{
		{"tmp_matcat", "material_categories"},
		{"tmp_modcat", "module_categories"},
		{"tmp_ambcat", "ambient_categories"},
		{"tmp_boards", "material_boards"},
		{"tmp_edges", "edge_bands"},
		{"tmp_hw", "hardwares"},
		{"tmp_comp", "components"},
		{"tmp_agr", "agregados"},
		{"tmp_struct", "structures"},
		{"tmp_optgrp", "option_groups"},
		{"tmp_modules", "modules"},
	}

	// The destination must be empty across EVERY table the clone writes —
	// both the mapped roots and the child tables the steps populate
	// (ambient_materials, board_parts, structure children…). Checking only
	// the roots let a destination with stray child rows pass the guard and
	// fail mid-transaction on UNIQUE(organization_id, code).
	dstTables := []string{
		"material_categories", "module_categories", "ambient_categories",
		"material_boards", "edge_bands", "hardwares", "components", "agregados",
		"option_groups", "option_group_members", "structures",
		"structure_components", "structure_presets", "modules",
		"board_parts", "hardware_lines", "module_components", "module_presets",
		"ambient_materials",
	}
	for _, table := range dstTables {
		var existing int
		if err := tx.QueryRow(ctx,
			`SELECT COUNT(*) FROM `+table+` WHERE organization_id = $1`, dstOrg).Scan(&existing); err != nil {
			return err
		}
		if existing > 0 {
			return fmt.Errorf("destination catalog is not empty: %s", table)
		}
	}
	for _, m := range maps {
		// F179: ON COMMIT DROP — temp tables live for the whole pooled
		// SESSION, so a second clone reusing the same server connection
		// crashed with "relation already exists" (the pilot onboarding of a
		// second organization on a long-lived server). Scope them to the
		// transaction instead.
		if _, err := tx.Exec(ctx, fmt.Sprintf(`CREATE TEMP TABLE %s ON COMMIT DROP AS
			SELECT id AS old_id, uuid_generate_v4() AS new_id FROM %s WHERE organization_id = $1`, m.name, m.table), srcOrg); err != nil {
			return fmt.Errorf("map %s: %w", m.name, err)
		}
		if _, err := tx.Exec(ctx, fmt.Sprintf(`CREATE UNIQUE INDEX ON %s(old_id)`, m.name)); err != nil {
			return err
		}
	}

	var unresolvedModuleID, unresolvedPath, unresolvedComponentID string
	err = tx.QueryRow(ctx, `
		SELECT module_id, path, component_id
		FROM (
			SELECT s.id::text AS module_id,
				format('parameter_definitions[%s].binding.componentId', definition_ordinality - 1) AS path,
				definition #>> '{binding,componentId}' AS component_id
			FROM modules s
			CROSS JOIN LATERAL jsonb_array_elements(s.parameter_definitions) WITH ORDINALITY AS definitions(definition, definition_ordinality)
			WHERE s.organization_id = $1 AND definition #> '{binding,componentId}' IS NOT NULL
			UNION ALL
			SELECT s.id::text AS module_id,
				format('parameter_definitions[%s].binding.relationship.targets[%s].componentId', definition_ordinality - 1, target_ordinality - 1) AS path,
				target->>'componentId' AS component_id
			FROM modules s
			CROSS JOIN LATERAL jsonb_array_elements(s.parameter_definitions) WITH ORDINALITY AS definitions(definition, definition_ordinality)
			CROSS JOIN LATERAL jsonb_array_elements(
				CASE WHEN jsonb_typeof(definition #> '{binding,relationship,targets}') = 'array'
					THEN definition #> '{binding,relationship,targets}' ELSE '[]'::jsonb END
			) WITH ORDINALITY AS targets(target, target_ordinality)
			WHERE s.organization_id = $1 AND target ? 'componentId'
		) component_references
		LEFT JOIN tmp_comp component_map ON component_map.old_id::text = component_references.component_id
		WHERE component_map.old_id IS NULL
		ORDER BY module_id, path
		LIMIT 1`, srcOrg).Scan(&unresolvedModuleID, &unresolvedPath, &unresolvedComponentID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("validate module parameter definition component references: %w", err)
	}
	if err == nil {
		return fmt.Errorf("module %s %s references component %q outside the source catalog", unresolvedModuleID, unresolvedPath, unresolvedComponentID)
	}

	steps := []struct {
		name   string
		params int // 2 = (src, dst); 1 = (dst) — src filtering already in temp maps
		sql    string
	}{
		{"material_categories", 1, `INSERT INTO material_categories (id, organization_id, name, parent_id, sort_order)
			SELECT m.new_id, $2, s.name, pm.new_id, s.sort_order
			FROM material_categories s
			JOIN tmp_matcat m ON m.old_id = s.id
			LEFT JOIN tmp_matcat pm ON pm.old_id = s.parent_id`},
		{"module_categories", 1, `INSERT INTO module_categories (id, organization_id, name, parent_id, sort_order)
			SELECT m.new_id, $2, s.name, pm.new_id, s.sort_order
			FROM module_categories s
			JOIN tmp_modcat m ON m.old_id = s.id
			LEFT JOIN tmp_modcat pm ON pm.old_id = s.parent_id`},
		{"ambient_categories", 1, `INSERT INTO ambient_categories (id, organization_id, name, parent_id, sort_order)
			SELECT m.new_id, $2, s.name, pm.new_id, s.sort_order
			FROM ambient_categories s
			JOIN tmp_ambcat m ON m.old_id = s.id
			LEFT JOIN tmp_ambcat pm ON pm.old_id = s.parent_id`},
		{"edge_bands", 1, `INSERT INTO edge_bands (id, organization_id, code, name, thickness_mm, cost_per_ml, notes, active, preview_color)
			SELECT m.new_id, $2, s.code, s.name, s.thickness_mm, s.cost_per_ml, s.notes, s.active, s.preview_color
			FROM edge_bands s JOIN tmp_edges m ON m.old_id = s.id`},
		{"hardwares", 1, `INSERT INTO hardwares (id, organization_id, code, name, unit, cost_per_unit, notes, active, image_url, package_size,
				preview_shape, preview_size_mm, preview_projection_mm, preview_diameter_mm, preview_color, preview_roughness,
				preview_metalness, preview_clearcoat, part_finishes, machining)
			SELECT m.new_id, $2, s.code, s.name, s.unit, s.cost_per_unit, s.notes, s.active, s.image_url, s.package_size,
				s.preview_shape, s.preview_size_mm, s.preview_projection_mm, s.preview_diameter_mm, s.preview_color, s.preview_roughness,
				s.preview_metalness, s.preview_clearcoat, s.part_finishes, s.machining
			FROM hardwares s JOIN tmp_hw m ON m.old_id = s.id`},
		{"components", 1, `INSERT INTO components (id, organization_id, code, name, placement, geometry_kind, length_mm, width_mm, thickness_mm,
				default_edges, option_roles, notes, active, length_formula, width_formula, x_formula, y_formula, z_formula,
				rotate_x, rotate_y, rotate_z)
			SELECT m.new_id, $2, s.code, s.name, s.placement, s.geometry_kind, s.length_mm, s.width_mm, s.thickness_mm,
				s.default_edges, s.option_roles, s.notes, s.active, s.length_formula, s.width_formula, s.x_formula, s.y_formula, s.z_formula,
				s.rotate_x, s.rotate_y, s.rotate_z
			FROM components s JOIN tmp_comp m ON m.old_id = s.id`},
		{"agregados", 1, fmt.Sprintf(`INSERT INTO agregados (id, organization_id, code, name, description, components, active, notes,
				width_mm, height_mm, depth_mm, hardware_lines)
			SELECT m.new_id, $2, s.code, s.name, s.description, %s, s.active, s.notes,
				s.width_mm, s.height_mm, s.depth_mm, %s
			FROM agregados s JOIN tmp_agr m ON m.old_id = s.id`,
			jsonbRemapKey("components", "componentId", "tmp_comp"),
			jsonbRemapKey("hardware_lines", "hardware_id", "tmp_hw"))},
		{"ambient_materials", 2, `INSERT INTO ambient_materials (id, organization_id, code, name, active, surface_type, preview_color,
				preview_texture_url, preview_texture_tile_width_mm, preview_texture_tile_length_mm, preview_roughness,
				preview_metalness, preview_clearcoat, category_id)
			SELECT gen_random_uuid(), $2, s.code, s.name, s.active, s.surface_type, s.preview_color,
				s.preview_texture_url, s.preview_texture_tile_width_mm, s.preview_texture_tile_length_mm, s.preview_roughness,
				s.preview_metalness, s.preview_clearcoat, cm.new_id
			FROM ambient_materials s
			LEFT JOIN tmp_ambcat cm ON cm.old_id = s.category_id
			WHERE s.organization_id = $1`},
		{"material_boards", 1, `INSERT INTO material_boards (id, organization_id, code, name, width_mm, length_mm, thickness_mm, board_price,
				waste_percent, notes, active, default_edge_band_id, grain_default, image_url, preview_color, preview_texture_url,
				preview_texture_tile_width_mm, preview_texture_tile_length_mm, preview_roughness, preview_metalness,
				preview_clearcoat, manufacturer, category_id)
			SELECT m.new_id, $2, s.code, s.name, s.width_mm, s.length_mm, s.thickness_mm, s.board_price,
				s.waste_percent, s.notes, s.active, em.new_id, s.grain_default, s.image_url, s.preview_color, s.preview_texture_url,
				s.preview_texture_tile_width_mm, s.preview_texture_tile_length_mm, s.preview_roughness, s.preview_metalness,
				s.preview_clearcoat, s.manufacturer, cm.new_id
			FROM material_boards s
			JOIN tmp_boards m ON m.old_id = s.id
			LEFT JOIN tmp_edges em ON em.old_id = s.default_edge_band_id
			LEFT JOIN tmp_matcat cm ON cm.old_id = s.category_id`},
		{"option_groups", 1, `INSERT INTO option_groups (id, organization_id, code, name, kind, required)
			SELECT m.new_id, $2, s.code, s.name, s.kind, s.required
			FROM option_groups s JOIN tmp_optgrp m ON m.old_id = s.id`},
		{"option_group_members", 1, `INSERT INTO option_group_members (option_group_id, entity_id, organization_id)
			SELECT gm.new_id,
				COALESCE(b.new_id, h.new_id, e.new_id, om.entity_id), $2
			FROM option_group_members om
			JOIN option_groups s ON s.id = om.option_group_id AND s.organization_id = $1
			JOIN tmp_optgrp gm ON gm.old_id = om.option_group_id
			LEFT JOIN tmp_boards b ON s.kind = 'board' AND b.old_id = om.entity_id
			LEFT JOIN tmp_hw h ON s.kind = 'hardware' AND h.old_id = om.entity_id
			LEFT JOIN tmp_edges e ON s.kind = 'edge' AND e.old_id = om.entity_id`},
		{"structures", 1, fmt.Sprintf(`INSERT INTO structures (id, organization_id, code, name, width_mm, height_mm, depth_mm, notes,
				active, revision, agregados, joint_drilling_rules)
			SELECT m.new_id, $2, s.code, s.name, s.width_mm, s.height_mm, s.depth_mm, s.notes,
				s.active, s.revision, %s, s.joint_drilling_rules
			FROM structures s JOIN tmp_struct m ON m.old_id = s.id`,
			jsonbRemapKey("agregados", "agregado_id", "tmp_agr"))},
		{"structure_components", 1, `INSERT INTO structure_components (id, organization_id, structure_id, component_id, quantity,
				placement_override, overrides)
			SELECT gen_random_uuid(), $2, sm.new_id, cm.new_id, s.quantity, s.placement_override, s.overrides
			FROM structure_components s
			JOIN tmp_struct sm ON sm.old_id = s.structure_id
			LEFT JOIN tmp_comp cm ON cm.old_id = s.component_id`},
		{"structure_presets", 1, `INSERT INTO structure_presets (id, organization_id, structure_id, name, width_mm, height_mm, depth_mm)
			SELECT gen_random_uuid(), $2, sm.new_id, s.name, s.width_mm, s.height_mm, s.depth_mm
			FROM structure_presets s JOIN tmp_struct sm ON sm.old_id = s.structure_id`},
		{"modules", 1, fmt.Sprintf(`INSERT INTO modules (id, organization_id, code, name, base_labor_cost, width_mm, height_mm, depth_mm,
				notes, category_id, image_url, structure_id, furniture_type, base_mode, base_clearance_mm, agregados, parameter_definitions)
			SELECT m.new_id, $2, s.code, s.name, s.base_labor_cost, s.width_mm, s.height_mm, s.depth_mm,
				s.notes, cm.new_id, s.image_url, st.new_id, s.furniture_type, s.base_mode, s.base_clearance_mm, %s, %s
			FROM modules s
			JOIN tmp_modules m ON m.old_id = s.id
			LEFT JOIN tmp_modcat cm ON cm.old_id = s.category_id
			LEFT JOIN tmp_struct st ON st.old_id = s.structure_id`,
			jsonbRemapKey("agregados", "agregado_id", "tmp_agr"),
			jsonbRemapParameterDefinitionComponents("parameter_definitions", "tmp_comp"))},
		{"board_parts", 1, `INSERT INTO board_parts (id, organization_id, module_id, code, description, quantity, length_mm, width_mm, option_role,
				edge_l1, edge_l2, edge_w1, edge_w2)
			SELECT gen_random_uuid(), $2, mm.new_id, s.code, s.description, s.quantity, s.length_mm, s.width_mm, s.option_role,
				s.edge_l1, s.edge_l2, s.edge_w1, s.edge_w2
			FROM board_parts s JOIN tmp_modules mm ON mm.old_id = s.module_id`},
		{"hardware_lines", 1, `INSERT INTO hardware_lines (id, organization_id, module_id, quantity, description_override, option_role, hardware_id)
			SELECT gen_random_uuid(), $2, mm.new_id, s.quantity, s.description_override, s.option_role, hm.new_id
			FROM hardware_lines s
			JOIN tmp_modules mm ON mm.old_id = s.module_id
			LEFT JOIN tmp_hw hm ON hm.old_id = s.hardware_id`},
		{"module_components", 1, `INSERT INTO module_components (id, organization_id, module_id, component_id, quantity, placement_override,
				length_formula, width_formula, overrides)
			SELECT gen_random_uuid(), $2, mm.new_id, cm.new_id, s.quantity, s.placement_override,
				s.length_formula, s.width_formula, s.overrides
			FROM module_components s
			JOIN tmp_modules mm ON mm.old_id = s.module_id
			LEFT JOIN tmp_comp cm ON cm.old_id = s.component_id`},
		{"module_presets", 1, `INSERT INTO module_presets (id, organization_id, module_id, name, width_mm, height_mm, depth_mm)
			SELECT gen_random_uuid(), $2, mm.new_id, s.name, s.width_mm, s.height_mm, s.depth_mm
			FROM module_presets s JOIN tmp_modules mm ON mm.old_id = s.module_id`},
	}

	for _, st := range steps {
		var err error
		if st.params == 2 {
			_, err = tx.Exec(ctx, st.sql, srcOrg, dstOrg)
		} else {
			// Single-param statements only reference the destination org.
			_, err = tx.Exec(ctx, strings.ReplaceAll(st.sql, "$2", "$1"), dstOrg)
		}
		if err != nil {
			return fmt.Errorf("clone %s: %w", st.name, err)
		}
	}
	if owned {
		return tx.Commit(ctx)
	}
	return nil
}

// UpdateOrganization persists mutable metadata. Lifecycle mutations must use
// TransitionOrganizationStatus so the credential epoch and audit boundary
// cannot be bypassed. The
// parent link is NOT mutable here — it is set at creation (#326) and only
// returned by the scan.
func (s *PostgresStore) UpdateOrganization(ctx context.Context, o *domain.Organization) error {
	return s.db(ctx).QueryRow(ctx, `
		SELECT `+organizationColumns+`
		FROM command_update_organization_metadata($1, $2, $3, $4, NULL)`,
		o.ID, o.Name, o.LicensePlan, o.LicenseExpiresAt).
		Scan(&o.ID, &o.Name, &o.Slug, &o.Type, &o.LicensePlan, &o.LicenseExpiresAt,
			&o.Status, &o.CredentialVersion, &o.StatusChangedAt, &o.StatusChangedBy,
			&o.StatusReason, &o.SuspendedAt, &o.OffboardingStartedAt, &o.TerminatedAt,
			&o.ParentOrganizationID, &o.CreatedAt, &o.UpdatedAt, &o.Version)
}

func (s *PostgresStore) UpdateOrganizationVersion(ctx context.Context, o *domain.Organization, expectedVersion int64) error {
	err := s.db(ctx).QueryRow(ctx, `
		SELECT `+organizationColumns+`
		FROM command_update_organization_metadata($1, $2, $3, $4, $5)`,
		o.ID, o.Name, o.LicensePlan, o.LicenseExpiresAt, expectedVersion).
		Scan(&o.ID, &o.Name, &o.Slug, &o.Type, &o.LicensePlan, &o.LicenseExpiresAt,
			&o.Status, &o.CredentialVersion, &o.StatusChangedAt, &o.StatusChangedBy,
			&o.StatusReason, &o.SuspendedAt, &o.OffboardingStartedAt, &o.TerminatedAt,
			&o.ParentOrganizationID, &o.CreatedAt, &o.UpdatedAt, &o.Version)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrVersionConflict
	}
	return err
}

func (s *PostgresStore) TransitionOrganizationStatus(
	ctx context.Context,
	id string,
	from, to domain.OrganizationStatus,
	actorID, reason string,
	expectedVersion int64,
) (*domain.Organization, error) {
	if !domain.CanTransitionOrganizationStatus(from, to) {
		return nil, ErrOrganizationStatusConflict
	}
	if to != domain.OrganizationStatusActive && strings.TrimSpace(reason) == "" {
		return nil, fmt.Errorf("organization lifecycle reason is required")
	}
	tx, owned, err := s.beginOrUseTx(ctx)
	if err != nil {
		return nil, err
	}
	if owned {
		defer tx.Rollback(ctx)
	}
	row := tx.QueryRow(ctx, `
		SELECT `+organizationColumns+`
		FROM command_transition_organization_status(
			$1, $2, $3, nullif($4, '')::uuid, $5, $6
		)`, id, from, to, actorID, strings.TrimSpace(reason), expectedVersion)
	organization, err := scanOrganization(row)
	if errors.Is(err, pgx.ErrNoRows) {
		var currentStatus domain.OrganizationStatus
		var currentVersion int64
		lookupErr := tx.QueryRow(ctx, `SELECT status, version FROM organizations WHERE id=$1`, id).
			Scan(&currentStatus, &currentVersion)
		if errors.Is(lookupErr, pgx.ErrNoRows) {
			return nil, fmt.Errorf("organization not found")
		}
		if lookupErr != nil {
			return nil, lookupErr
		}
		if currentVersion != expectedVersion {
			return nil, ErrVersionConflict
		}
		return nil, ErrOrganizationStatusConflict
	}
	if err != nil {
		return nil, err
	}
	if owned {
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
	}
	return organization, nil
}

func (s *PostgresStore) GetOrganizationEntitlements(ctx context.Context, organizationID string) (*domain.OrganizationEntitlements, error) {
	out := &domain.OrganizationEntitlements{}
	err := s.db(ctx).QueryRow(ctx, `
		SELECT organization_id, max_active_members, max_sales_partners,
			manufacturing_enabled, sales_network_enabled, sketchup_seats,
			advanced_audit_enabled, source, defaults_revision, version, updated_at
		FROM organization_entitlements WHERE organization_id=$1`, organizationID).
		Scan(&out.OrganizationID, &out.MaxActiveMembers, &out.MaxSalesPartners,
			&out.ManufacturingEnabled, &out.SalesNetworkEnabled, &out.SketchupSeats,
			&out.AdvancedAuditEnabled, &out.Source, &out.DefaultsRevision,
			&out.Version, &out.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("organization entitlements not found")
	}
	return out, err
}

func (s *PostgresStore) UpdateOrganizationEntitlementsVersion(
	ctx context.Context,
	entitlements domain.OrganizationEntitlements,
	expectedVersion int64,
) (*domain.OrganizationEntitlements, error) {
	if entitlements.MaxActiveMembers != nil && *entitlements.MaxActiveMembers < 1 {
		return nil, fmt.Errorf("max active members must be positive")
	}
	if entitlements.MaxSalesPartners < 0 || entitlements.SketchupSeats < 0 || strings.TrimSpace(entitlements.DefaultsRevision) == "" {
		return nil, fmt.Errorf("invalid organization entitlements")
	}
	err := s.db(ctx).QueryRow(ctx, `
		UPDATE organization_entitlements
		SET max_active_members=$2, max_sales_partners=$3,
			manufacturing_enabled=$4, sales_network_enabled=$5,
			sketchup_seats=$6, advanced_audit_enabled=$7, source=$8,
			defaults_revision=$9, version=version+1, updated_at=NOW()
		WHERE organization_id=$1 AND version=$10
		RETURNING organization_id, max_active_members, max_sales_partners,
			manufacturing_enabled, sales_network_enabled, sketchup_seats,
			advanced_audit_enabled, source, defaults_revision, version, updated_at`,
		entitlements.OrganizationID, entitlements.MaxActiveMembers, entitlements.MaxSalesPartners,
		entitlements.ManufacturingEnabled, entitlements.SalesNetworkEnabled,
		entitlements.SketchupSeats, entitlements.AdvancedAuditEnabled,
		entitlements.Source, strings.TrimSpace(entitlements.DefaultsRevision), expectedVersion).
		Scan(&entitlements.OrganizationID, &entitlements.MaxActiveMembers, &entitlements.MaxSalesPartners,
			&entitlements.ManufacturingEnabled, &entitlements.SalesNetworkEnabled,
			&entitlements.SketchupSeats, &entitlements.AdvancedAuditEnabled,
			&entitlements.Source, &entitlements.DefaultsRevision,
			&entitlements.Version, &entitlements.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrVersionConflict
	}
	return &entitlements, err
}
