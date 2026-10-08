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
	id, organization_id, code, name, grip_type, cross_section_shape,
	compatible_placements, datasheet_status, geometry_origin,
	front_reduction_mm, grip_clearance_mm, profile_height_mm, profile_depth_mm,
	body_modifiers, bom_members, active, version, created_at, updated_at
`

func scanOpeningProfile(row pgx.Row) (*domain.OpeningProfile, error) {
	var p domain.OpeningProfile
	err := row.Scan(
		&p.ID, &p.OrganizationID, &p.Code, &p.Name, &p.GripType, &p.CrossSectionShape,
		&p.CompatiblePlacements, &p.DatasheetStatus, &p.GeometryOrigin,
		&p.FrontReductionMm, &p.GripClearanceMm, &p.ProfileHeightMm, &p.ProfileDepthMm,
		&p.BodyModifiers, &p.BOMMembers, &p.Active, &p.Version, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
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

func (s *PostgresStore) CreateOpeningProfile(ctx context.Context, profile *domain.OpeningProfile) error {
	if err := domain.ValidateOpeningProfile(*profile); err != nil {
		return err
	}
	query := `
		INSERT INTO opening_profiles (
			id, organization_id, code, name, grip_type, cross_section_shape,
			compatible_placements, datasheet_status, geometry_origin,
			front_reduction_mm, grip_clearance_mm, profile_height_mm, profile_depth_mm,
			body_modifiers, bom_members, active, version
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,1)
		RETURNING ` + openingProfileColumns + `;
	`
	row := s.db(ctx).QueryRow(ctx, query,
		profile.ID, OrgFromCtx(ctx), profile.Code, profile.Name, profile.GripType, profile.CrossSectionShape,
		profile.CompatiblePlacements, profile.DatasheetStatus, profile.GeometryOrigin,
		profile.FrontReductionMm, profile.GripClearanceMm, profile.ProfileHeightMm, profile.ProfileDepthMm,
		profile.BodyModifiers, profile.BOMMembers, profile.Active,
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
	if err := domain.ValidateOpeningProfile(*profile); err != nil {
		return err
	}
	query := `
		UPDATE opening_profiles SET
			code = $3, name = $4, grip_type = $5, cross_section_shape = $6,
			compatible_placements = $7, datasheet_status = $8, geometry_origin = $9,
			front_reduction_mm = $10, grip_clearance_mm = $11, profile_height_mm = $12, profile_depth_mm = $13,
			body_modifiers = $14, bom_members = $15, active = $16,
			version = version + 1, updated_at = NOW()
		WHERE id = $1 AND organization_id = $2 AND version = $17
		RETURNING ` + openingProfileColumns + `;
	`
	row := s.db(ctx).QueryRow(ctx, query,
		id, OrgFromCtx(ctx), profile.Code, profile.Name, profile.GripType, profile.CrossSectionShape,
		profile.CompatiblePlacements, profile.DatasheetStatus, profile.GeometryOrigin,
		profile.FrontReductionMm, profile.GripClearanceMm, profile.ProfileHeightMm, profile.ProfileDepthMm,
		profile.BodyModifiers, profile.BOMMembers, profile.Active,
		expectedVersion,
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

func translateOpeningProfileWriteError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrOpeningProfileNotFound
	}
	return err
}
