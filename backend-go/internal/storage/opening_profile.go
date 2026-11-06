package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// --- OPENING PROFILES (#1130, épica #1128 / ADR-0009) ---
//
// The physical grip profile catalog (gola L/C, REACH…). Datasheet-backed
// geometry columns are *int so NULL (not provided yet, OQ-2) stays distinct
// from 0 — a blocked authoring state, never a default. Writes are If-Match
// guarded (version) like every simple catalog family (#1091/#443).

const openingProfileColumns = `
	id, organization_id, code, name, manufacturer, grip_type, cross_section_shape,
	compatible_placements, datasheet_status, geometry_origin,
	front_reduction_mm, grip_clearance_mm, profile_height_mm, profile_depth_mm,
	door_reduction_mm,
	body_modifiers, bom_members, active, version, created_at, updated_at,
	COALESCE(material, ''), positions, front_discount_top_mm, front_discount_between_mm,
	v2_migration
`

func scanOpeningProfile(row pgx.Row) (*domain.OpeningProfile, error) {
	var p domain.OpeningProfile
	err := row.Scan(
		&p.ID, &p.OrganizationID, &p.Code, &p.Name, &p.Manufacturer, &p.GripType, &p.CrossSectionShape,
		&p.CompatiblePlacements, &p.DatasheetStatus, &p.GeometryOrigin,
		&p.FrontReductionMm, &p.GripClearanceMm, &p.ProfileHeightMm, &p.ProfileDepthMm,
		&p.DoorReductionMm,
		&p.BodyModifiers, &p.BOMMembers, &p.Active, &p.Version, &p.CreatedAt, &p.UpdatedAt,
		&p.Material, &p.Positions, &p.FrontDiscountTopMm, &p.FrontDiscountBetweenMm,
		&p.V2Migration,
	)
	if err != nil {
		return nil, err
	}
	// #1530: the per-position use rule is computed on every read, never stored.
	p.WithUsage()
	return &p, nil
}

func (s *PostgresStore) ListOpeningProfiles(ctx context.Context) ([]domain.OpeningProfile, error) {
	query := `
		SELECT ` + openingProfileColumns + `
		FROM opening_profiles
		WHERE organization_id = $1
		ORDER BY code ASC;
	`
	rows, err := s.db(ctx).Query(ctx, query, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []domain.OpeningProfile{}
	for rows.Next() {
		profile, err := scanOpeningProfile(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *profile)
	}
	return list, nil
}

func (s *PostgresStore) GetOpeningProfileByID(ctx context.Context, id string) (*domain.OpeningProfile, error) {
	query := `
		SELECT ` + openingProfileColumns + `
		FROM opening_profiles
		WHERE id = $1 AND organization_id = $2;
	`
	profile, err := scanOpeningProfile(s.db(ctx).QueryRow(ctx, query, id, OrgFromCtx(ctx)))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("opening profile not found")
		}
		return nil, err
	}
	return profile, nil
}

// openingProfileJSONColumns normalizes the declared JSONB slices for the
// NOT NULL columns (#1325): a profile authored WITHOUT body modifiers or
// BOM members writes their empty JSON — the truthful absence — never a NULL
// that the constraint (and every honest create) rejects.
func openingProfileJSONColumns(profile *domain.OpeningProfile) ([]domain.OpeningBodyModifier, map[string]domain.OpeningBOMMember) {
	bodyModifiers := profile.BodyModifiers
	if bodyModifiers == nil {
		bodyModifiers = []domain.OpeningBodyModifier{}
	}
	bomMembers := profile.BOMMembers
	if bomMembers == nil {
		bomMembers = map[string]domain.OpeningBOMMember{}
	}
	return bodyModifiers, bomMembers
}

func (s *PostgresStore) CreateOpeningProfile(ctx context.Context, profile *domain.OpeningProfile) error {
	domain.NormalizeOpeningProfileWrite(profile, nil)
	if err := domain.ValidateOpeningProfile(*profile); err != nil {
		return err
	}
	if err := s.validateOpeningProfileReferences(ctx, profile); err != nil {
		return err
	}
	bodyModifiers, bomMembers := openingProfileJSONColumns(profile)
	query := `
		INSERT INTO opening_profiles (
			id, organization_id, code, name, manufacturer, grip_type, cross_section_shape,
			compatible_placements, datasheet_status, geometry_origin,
			front_reduction_mm, grip_clearance_mm, profile_height_mm, profile_depth_mm,
			door_reduction_mm,
			body_modifiers, bom_members, active, version,
			material, positions, front_discount_top_mm, front_discount_between_mm
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,1,$19,$20,$21,$22)
		RETURNING ` + openingProfileColumns + `
	`
	row := s.db(ctx).QueryRow(ctx, query,
		profile.ID, OrgFromCtx(ctx), profile.Code, profile.Name, profile.Manufacturer, profile.GripType, profile.CrossSectionShape,
		profile.CompatiblePlacements, profile.DatasheetStatus, profile.GeometryOrigin,
		profile.FrontReductionMm, profile.GripClearanceMm, profile.ProfileHeightMm, profile.ProfileDepthMm,
		profile.DoorReductionMm,
		bodyModifiers, bomMembers, profile.Active,
		profile.Material, profile.Positions, profile.FrontDiscountTopMm, profile.FrontDiscountBetweenMm,
	)
	created, err := scanOpeningProfile(row)
	if err != nil {
		return translateOpeningProfileWriteError(err)
	}
	*profile = *created
	return nil
}

// UpdateOpeningProfile is If-Match guarded: expectedVersion must match the
// stored version or the write is rejected (optimistic concurrency, the
// simple-catalog contract #1091/#443).
func (s *PostgresStore) UpdateOpeningProfile(ctx context.Context, id string, expectedVersion int64, profile *domain.OpeningProfile) error {
	// The stored row drives the legacy bridge (bridge until #1534): a legacy
	// client cannot express the v2-only values, and a whole-row client may
	// edit only door_reduction_mm. A missing row falls through to the
	// guarded UPDATE, which answers not-found.
	var existing *domain.OpeningProfile
	if stored, err := s.GetOpeningProfileByID(ctx, id); err == nil {
		existing = stored
	}
	domain.NormalizeOpeningProfileWrite(profile, existing)
	if err := domain.ValidateOpeningProfile(*profile); err != nil {
		return err
	}
	if err := s.validateOpeningProfileReferences(ctx, profile); err != nil {
		return err
	}
	bodyModifiers, bomMembers := openingProfileJSONColumns(profile)
	query := `
		UPDATE opening_profiles SET
			code = $3, name = $4, manufacturer = $5, grip_type = $6, cross_section_shape = $7,
			compatible_placements = $8, datasheet_status = $9, geometry_origin = $10,
			front_reduction_mm = $11, grip_clearance_mm = $12, profile_height_mm = $13, profile_depth_mm = $14,
			door_reduction_mm = $15,
			body_modifiers = $16, bom_members = $17, active = $18,
			material = $20, positions = $21, front_discount_top_mm = $22, front_discount_between_mm = $23,
			version = version + 1, updated_at = NOW()
		WHERE id = $1 AND organization_id = $2 AND version = $19
		RETURNING ` + openingProfileColumns + `
	`
	row := s.db(ctx).QueryRow(ctx, query,
		id, OrgFromCtx(ctx), profile.Code, profile.Name, profile.Manufacturer, profile.GripType, profile.CrossSectionShape,
		profile.CompatiblePlacements, profile.DatasheetStatus, profile.GeometryOrigin,
		profile.FrontReductionMm, profile.GripClearanceMm, profile.ProfileHeightMm, profile.ProfileDepthMm,
		profile.DoorReductionMm,
		bodyModifiers, bomMembers, profile.Active,
		expectedVersion,
		profile.Material, profile.Positions, profile.FrontDiscountTopMm, profile.FrontDiscountBetweenMm,
	)
	updated, err := scanOpeningProfile(row)
	if err != nil {
		return s.openingProfileWriteError(ctx, id)
	}
	*profile = *updated
	return nil
}

// DeactivateOpeningProfile retires the profile (soft: BOM/authoring history
// keeps referencing it; disabling a capability never rewrites a design).
func (s *PostgresStore) DeactivateOpeningProfile(ctx context.Context, id string, expectedVersion int64) error {
	query := `
		UPDATE opening_profiles SET active = false, version = version + 1, updated_at = NOW()
		WHERE id = $1 AND organization_id = $2 AND version = $3;
	`
	tag, err := s.db(ctx).Exec(ctx, query, id, OrgFromCtx(ctx), expectedVersion)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return s.openingProfileWriteError(ctx, id)
	}
	return nil
}

// ErrOpeningProfileNotFound separates a missing row from a version
// conflict: the API maps it to 404 (the client's recreate path) while the
// conflict maps to 412 like the rest of the If-Match catalog family.
var ErrOpeningProfileNotFound = errors.New("opening profile not found")

// openingProfileWriteError distinguishes not-found from version conflict
// with one existence probe inside the caller's transaction context.
func (s *PostgresStore) openingProfileWriteError(ctx context.Context, id string) error {
	var exists bool
	if err := s.db(ctx).QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM opening_profiles WHERE id = $1 AND organization_id = $2)`,
		id, OrgFromCtx(ctx)).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrOpeningProfileNotFound
	}
	return ErrVersionConflict
}

// validateOpeningProfileReferences checks that every part reference exists in
// the caller's catalog (RLS-scoped): the hardware roles point to a hardware
// row and the strip points to a component row (#1530).
func (s *PostgresStore) validateOpeningProfileReferences(ctx context.Context, profile *domain.OpeningProfile) error {
	for key, member := range profile.BOMMembers {
		table, ref := "hardwares", member.HardwareID
		if key == domain.GolaRoleStrip {
			table, ref = "components", member.ComponentID
		}
		var exists bool
		query := `SELECT EXISTS (SELECT 1 FROM ` + table + ` WHERE id::text = $1 AND organization_id = $2)`
		if err := s.db(ctx).QueryRow(ctx, query, ref, OrgFromCtx(ctx)).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			if table == "components" {
				return &domain.OpeningProfileValidationError{Message: fmt.Sprintf("la tira referencia un componente que no existe en el catálogo (%s)", ref)}
			}
			return &domain.OpeningProfileValidationError{Message: fmt.Sprintf("el rol %q referencia un herraje que no existe en el catálogo (%s)", key, ref)}
		}
	}
	return nil
}

func translateOpeningProfileWriteError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrOpeningProfileNotFound
	}
	return err
}
