package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Hardware Profile persistence (#913): tenant-scoped CRUD over the frozen
// #912 domain contract. The row stores hardware references verbatim (items +
// recipe ref as JSONB); commercial identity (code/price/unit) always lives in
// the hardwares table and is resolved at consumption time. Every mutation is
// optimistic-concurrency guarded (#443/#448): version is server-owned,
// create starts at 1, and every accepted update increments it inside the
// same transaction — a stale expected-version is ErrVersionConflict, never a
// silent overwrite.

// --- HARDWARE PROFILES ---

func (s *PostgresStore) ListHardwareProfiles(ctx context.Context) ([]domain.HardwareProfile, error) {
	query := `
		SELECT id, code, name, description, revision, items, recipe_ref, recipe, active, version, created_at, updated_at
		FROM hardware_profiles
		WHERE organization_id = $1
		ORDER BY code ASC, id ASC;
	`
	rows, err := s.db(ctx).Query(ctx, query, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.HardwareProfile
	for rows.Next() {
		profile, err := scanHardwareProfile(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *profile)
	}
	if list == nil {
		list = []domain.HardwareProfile{}
	}
	return list, nil
}

func (s *PostgresStore) GetHardwareProfileByID(ctx context.Context, id string) (*domain.HardwareProfile, error) {
	query := `
		SELECT id, code, name, description, revision, items, recipe_ref, recipe, active, version, created_at, updated_at
		FROM hardware_profiles
		WHERE id = $1 AND organization_id = $2;
	`
	row := s.db(ctx).QueryRow(ctx, query, id, OrgFromCtx(ctx))
	profile, err := scanHardwareProfile(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("hardware profile not found")
		}
		return nil, err
	}
	return profile, nil
}

func (s *PostgresStore) CreateHardwareProfile(ctx context.Context, p *domain.HardwareProfile) error {
	itemsJSON, err := hardwareProfileItemsArg(p.Items)
	if err != nil {
		return err
	}
	recipeRefJSON, err := hardwareProfileRecipeRefArg(p.RecipeRef)
	if err != nil {
		return err
	}
	recipeJSON, err := hardwareProfileRecipeBodyArg(p.Recipe)
	if err != nil {
		return err
	}
	if p.ID != "" {
		query := `
			INSERT INTO hardware_profiles (id, code, name, description, revision, items, recipe_ref, recipe, active, organization_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			RETURNING created_at, updated_at, version;
		`
		if err := s.db(ctx).QueryRow(ctx, query, p.ID, p.Code, p.Name, p.Description, p.Revision, itemsJSON, recipeRefJSON, recipeJSON, p.Active, OrgFromCtx(ctx)).
			Scan(&p.CreatedAt, &p.UpdatedAt, &p.Version); err != nil {
			return fmt.Errorf("error creating hardware profile: %w", err)
		}
		return nil
	}
	query := `
		INSERT INTO hardware_profiles (code, name, description, revision, items, recipe_ref, recipe, active, organization_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, created_at, updated_at, version;
	`
	if err := s.db(ctx).QueryRow(ctx, query, p.Code, p.Name, p.Description, p.Revision, itemsJSON, recipeRefJSON, recipeJSON, p.Active, OrgFromCtx(ctx)).
		Scan(&p.ID, &p.CreatedAt, &p.UpdatedAt, &p.Version); err != nil {
		return fmt.Errorf("error creating hardware profile: %w", err)
	}
	return nil
}

func (s *PostgresStore) UpdateHardwareProfile(ctx context.Context, id string, expectedVersion int64, p *domain.HardwareProfile) error {
	itemsJSON, err := hardwareProfileItemsArg(p.Items)
	if err != nil {
		return err
	}
	recipeRefJSON, err := hardwareProfileRecipeRefArg(p.RecipeRef)
	if err != nil {
		return err
	}
	query := `
		UPDATE hardware_profiles
		SET code = $1, name = $2, description = $3, revision = $4, items = $5, recipe_ref = $6, recipe = $7, active = $8, updated_at = CURRENT_TIMESTAMP, version = version + 1
		WHERE id = $9 AND organization_id = $10 AND version = $11
		RETURNING updated_at, version;
	`
	recipeJSON, err := hardwareProfileRecipeBodyArg(p.Recipe)
	if err != nil {
		return err
	}
	err = s.db(ctx).QueryRow(ctx, query, p.Code, p.Name, p.Description, p.Revision, itemsJSON, recipeRefJSON, recipeJSON, p.Active, id, OrgFromCtx(ctx), expectedVersion).
		Scan(&p.UpdatedAt, &p.Version)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Missing row and stale version both surface as ErrNoRows here;
			// disambiguate so clients get 404 vs 412 instead of guessing.
			var exists bool
			if checkErr := s.db(ctx).QueryRow(ctx,
				`SELECT EXISTS (SELECT 1 FROM hardware_profiles WHERE id = $1 AND organization_id = $2)`,
				id, OrgFromCtx(ctx)).Scan(&exists); checkErr != nil {
				return fmt.Errorf("error checking hardware profile existence: %w", checkErr)
			}
			if !exists {
				return fmt.Errorf("hardware profile not found")
			}
			return ErrVersionConflict
		}
		return fmt.Errorf("error updating hardware profile: %w", err)
	}
	p.ID = id
	return nil
}

func (s *PostgresStore) DeactivateHardwareProfile(ctx context.Context, id string, expectedVersion int64) error {
	query := `
		UPDATE hardware_profiles
		SET active = false, updated_at = CURRENT_TIMESTAMP, version = version + 1
		WHERE id = $1 AND organization_id = $2 AND version = $3
		RETURNING version;
	`
	var version int64
	err := s.db(ctx).QueryRow(ctx, query, id, OrgFromCtx(ctx), expectedVersion).Scan(&version)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			var exists bool
			if checkErr := s.db(ctx).QueryRow(ctx,
				`SELECT EXISTS (SELECT 1 FROM hardware_profiles WHERE id = $1 AND organization_id = $2)`,
				id, OrgFromCtx(ctx)).Scan(&exists); checkErr != nil {
				return fmt.Errorf("error checking hardware profile existence: %w", checkErr)
			}
			if !exists {
				return fmt.Errorf("hardware profile not found")
			}
			return ErrVersionConflict
		}
		return fmt.Errorf("error deactivating hardware profile: %w", err)
	}
	return nil
}

// ExistingHardwareIDs returns which of the given hardware ids exist (any
// active state) in the caller's organization. Profile item references are
// validated against this set: a profile may only reference hardware of its
// own scope (#913 acceptance).
func (s *PostgresStore) ExistingHardwareIDs(ctx context.Context, ids []string) (map[string]bool, error) {
	existing := map[string]bool{}
	if len(ids) == 0 {
		return existing, nil
	}
	query := `SELECT id FROM hardwares WHERE id = ANY($1) AND organization_id = $2`
	rows, err := s.db(ctx).Query(ctx, query, ids, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		existing[id] = true
	}
	return existing, nil
}

// ListActiveHardwareProfilesAnyOrg reads every active profile across all
// organizations. It exists for Standard release compilation (#918): the
// Granete-staff publish path gathers canonical profiles — including
// Granete-authored org rows — into immutable release blobs. This is an
// explicit cross-tenant ADMIN read (compilation context), never exposed
// through tenant handlers; RLS still bounds every tenant-scoped call.
func (s *PostgresStore) ListActiveHardwareProfilesAnyOrg(ctx context.Context) ([]domain.HardwareProfile, error) {
	query := `
		SELECT id, code, name, description, revision, items, recipe_ref, recipe, active, version, created_at, updated_at
		FROM hardware_profiles
		WHERE active = TRUE
		ORDER BY code ASC, id ASC;
	`
	rows, err := s.db(ctx).Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []domain.HardwareProfile{}
	for rows.Next() {
		profile, err := scanHardwareProfile(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *profile)
	}
	return list, nil
}

// --- JSONB helpers ---

func hardwareProfileItemsArg(items []domain.HardwareProfileItem) ([]byte, error) {
	if items == nil {
		items = []domain.HardwareProfileItem{}
	}
	raw, err := json.Marshal(items)
	if err != nil {
		return nil, fmt.Errorf("encode hardware profile items: %w", err)
	}
	return raw, nil
}

func hardwareProfileRecipeRefArg(recipeRef *domain.ProfileRecipeRef) (interface{}, error) {
	if recipeRef == nil {
		return nil, nil
	}
	raw, err := json.Marshal(recipeRef)
	if err != nil {
		return nil, fmt.Errorf("encode hardware profile recipe ref: %w", err)
	}
	return raw, nil
}

func hardwareProfileRecipeBodyArg(recipe *domain.ProfileRecipeBody) (interface{}, error) {
	if recipe == nil {
		return nil, nil
	}
	raw, err := json.Marshal(recipe)
	if err != nil {
		return nil, fmt.Errorf("encode hardware profile recipe body: %w", err)
	}
	return raw, nil
}

type hardwareProfileRowScanner interface {
	Scan(dest ...any) error
}

func scanHardwareProfile(row hardwareProfileRowScanner) (*domain.HardwareProfile, error) {
	var p domain.HardwareProfile
	var itemsRaw []byte
	var recipeRefRaw []byte
	var recipeRaw []byte
	if err := row.Scan(&p.ID, &p.Code, &p.Name, &p.Description, &p.Revision, &itemsRaw, &recipeRefRaw, &recipeRaw, &p.Active, &p.Version, &p.CreatedAt, &p.UpdatedAt); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(itemsRaw, &p.Items); err != nil {
		return nil, fmt.Errorf("decode hardware profile items: %w", err)
	}
	if p.Items == nil {
		p.Items = []domain.HardwareProfileItem{}
	}
	if recipeRefRaw != nil {
		var recipeRef domain.ProfileRecipeRef
		if err := json.Unmarshal(recipeRefRaw, &recipeRef); err != nil {
			return nil, fmt.Errorf("decode hardware profile recipe ref: %w", err)
		}
		p.RecipeRef = &recipeRef
	}
	if recipeRaw != nil {
		var recipe domain.ProfileRecipeBody
		if err := json.Unmarshal(recipeRaw, &recipe); err != nil {
			return nil, fmt.Errorf("decode hardware profile recipe body: %w", err)
		}
		p.Recipe = &recipe
	}
	return &p, nil
}
