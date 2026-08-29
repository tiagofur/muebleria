package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// --- AMBIENT MATERIALS & CATEGORIES (presentation-only surfaces & finishes, #4150 / F086) ---
//
// Mirrors the material_boards store pattern (pgxpool, hand-written) minus the
// pricing/BOM columns — ambient materials carry only the preview_* subset and
// a category_id pointing to ambient_categories.
// The preview_* numeric fields are *float64 so NULL (unset) stays distinct
// from 0 in the JSON contract the client optionalNum helper depends on.

func (s *PostgresStore) ListAmbientCategories(ctx context.Context) ([]domain.AmbientCategory, error) {
	query := `
		SELECT id, name, parent_id, sort_order, created_at, updated_at
		FROM ambient_categories
		WHERE organization_id = $1
		ORDER BY sort_order ASC, name ASC;
	`
	rows, err := s.db(ctx).Query(ctx, query, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.AmbientCategory
	for rows.Next() {
		var c domain.AmbientCategory
		var parentID *string
		err := rows.Scan(&c.ID, &c.Name, &parentID, &c.SortOrder, &c.CreatedAt, &c.UpdatedAt)
		if err != nil {
			return nil, err
		}
		if parentID != nil {
			c.ParentID = *parentID
		}
		list = append(list, c)
	}
	if list == nil {
		list = []domain.AmbientCategory{}
	}
	return list, nil
}

func (s *PostgresStore) GetAmbientCategoryByID(ctx context.Context, id string) (*domain.AmbientCategory, error) {
	query := `
		SELECT id, name, parent_id, sort_order, created_at, updated_at
		FROM ambient_categories
		WHERE id = $1 AND organization_id = $2;
	`
	row := s.db(ctx).QueryRow(ctx, query, id, OrgFromCtx(ctx))
	var c domain.AmbientCategory
	var parentID *string
	err := row.Scan(&c.ID, &c.Name, &parentID, &c.SortOrder, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("ambient category not found")
		}
		return nil, err
	}
	if parentID != nil {
		c.ParentID = *parentID
	}
	return &c, nil
}

func (s *PostgresStore) CreateAmbientCategory(ctx context.Context, c *domain.AmbientCategory) error {
	all, err := s.ListAmbientCategories(ctx)
	if err != nil {
		return err
	}
	if err := domain.ValidateAmbientCategoryPlacement(c.ParentID, all, ""); err != nil {
		return fmt.Errorf("invalid category placement: %w", err)
	}
	if c.Name == "" {
		return fmt.Errorf("category name is required")
	}

	var parent interface{}
	if c.ParentID != "" {
		parent = c.ParentID
	}

	if c.ID != "" {
		query := `
			INSERT INTO ambient_categories (id, name, parent_id, sort_order, organization_id)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING created_at, updated_at;
		`
		return s.db(ctx).QueryRow(ctx, query, c.ID, c.Name, parent, c.SortOrder, OrgFromCtx(ctx)).
			Scan(&c.CreatedAt, &c.UpdatedAt)
	}

	query := `
		INSERT INTO ambient_categories (name, parent_id, sort_order, organization_id)
		VALUES ($1, $2, $3, $4)
		RETURNING id, created_at, updated_at;
	`
	return s.db(ctx).QueryRow(ctx, query, c.Name, parent, c.SortOrder, OrgFromCtx(ctx)).
		Scan(&c.ID, &c.CreatedAt, &c.UpdatedAt)
}

func (s *PostgresStore) UpdateAmbientCategory(ctx context.Context, id string, c *domain.AmbientCategory) error {
	all, err := s.ListAmbientCategories(ctx)
	if err != nil {
		return err
	}
	if err := domain.ValidateAmbientCategoryPlacement(c.ParentID, all, id); err != nil {
		return fmt.Errorf("invalid category placement: %w", err)
	}
	if c.Name == "" {
		return fmt.Errorf("category name is required")
	}

	var parent interface{}
	if c.ParentID != "" {
		parent = c.ParentID
	}

	query := `
		UPDATE ambient_categories
		SET name = $1, parent_id = $2, sort_order = $3, updated_at = CURRENT_TIMESTAMP
		WHERE id = $4 AND organization_id = $5
		RETURNING updated_at;
	`
	err = s.db(ctx).QueryRow(ctx, query, c.Name, parent, c.SortOrder, id, OrgFromCtx(ctx)).Scan(&c.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("ambient category not found")
		}
		return err
	}
	c.ID = id
	return nil
}

func (s *PostgresStore) DeleteAmbientCategory(ctx context.Context, id string) error {
	children, err := s.db(ctx).Query(ctx, `SELECT id FROM ambient_categories WHERE parent_id = $1 AND organization_id = $2 LIMIT 1`, id, OrgFromCtx(ctx))
	if err != nil {
		return err
	}
	defer children.Close()
	if children.Next() {
		return fmt.Errorf("cannot delete category with children; reparent or delete children first")
	}

	_, err = s.db(ctx).Exec(ctx, `DELETE FROM ambient_categories WHERE id = $1 AND organization_id = $2`, id, OrgFromCtx(ctx))
	return err
}

func (s *PostgresStore) ListAmbientMaterials(ctx context.Context) ([]domain.AmbientMaterial, error) {
	query := `
		SELECT id, code, name, active, surface_type, category_id, preview_color, preview_texture_url, preview_texture_tile_width_mm, preview_texture_tile_length_mm, preview_roughness, preview_metalness, preview_clearcoat
		FROM ambient_materials
		WHERE organization_id = $1
		ORDER BY name ASC;
	`
	rows, err := s.db(ctx).Query(ctx, query, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.AmbientMaterial
	for rows.Next() {
		m, err := scanAmbientMaterial(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, m)
	}
	if list == nil {
		list = []domain.AmbientMaterial{}
	}
	return list, rows.Err()
}

func (s *PostgresStore) GetAmbientMaterialByID(ctx context.Context, id string) (*domain.AmbientMaterial, error) {
	query := `
		SELECT id, code, name, active, surface_type, category_id, preview_color, preview_texture_url, preview_texture_tile_width_mm, preview_texture_tile_length_mm, preview_roughness, preview_metalness, preview_clearcoat
		FROM ambient_materials
		WHERE id = $1 AND organization_id = $2;
	`
	row := s.db(ctx).QueryRow(ctx, query, id, OrgFromCtx(ctx))
	m, err := scanAmbientMaterial(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("ambient material not found")
		}
		return nil, err
	}
	return &m, nil
}

func (s *PostgresStore) CreateAmbientMaterial(ctx context.Context, m *domain.AmbientMaterial) error {
	query := `
		INSERT INTO ambient_materials (id, code, name, active, surface_type, category_id, preview_color, preview_texture_url, preview_texture_tile_width_mm, preview_texture_tile_length_mm, preview_roughness, preview_metalness, preview_clearcoat, organization_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);
	`
	_, err := s.db(ctx).Exec(ctx, query,
		m.ID, m.Code, m.Name, m.Active, string(m.SurfaceType),
		nullIfEmpty(m.CategoryID),
		nullIfEmpty(m.PreviewColor), nullIfEmpty(m.PreviewTextureURL),
		m.PreviewTextureTileWidthMm, m.PreviewTextureTileLengthMm,
		m.PreviewRoughness, m.PreviewMetalness, m.PreviewClearcoat,
		OrgFromCtx(ctx),
	)
	if err != nil {
		return fmt.Errorf("error creating ambient material: %w", err)
	}
	return nil
}

func (s *PostgresStore) UpdateAmbientMaterial(ctx context.Context, id string, m *domain.AmbientMaterial) error {
	query := `
		UPDATE ambient_materials
		SET code = $1, name = $2, active = $3, surface_type = $4, category_id = $5, preview_color = $6, preview_texture_url = $7, preview_texture_tile_width_mm = $8, preview_texture_tile_length_mm = $9, preview_roughness = $10, preview_metalness = $11, preview_clearcoat = $12
		WHERE id = $13 AND organization_id = $14;
	`
	tag, err := s.db(ctx).Exec(ctx, query,
		m.Code, m.Name, m.Active, string(m.SurfaceType),
		nullIfEmpty(m.CategoryID),
		nullIfEmpty(m.PreviewColor), nullIfEmpty(m.PreviewTextureURL),
		m.PreviewTextureTileWidthMm, m.PreviewTextureTileLengthMm,
		m.PreviewRoughness, m.PreviewMetalness, m.PreviewClearcoat,
		id, OrgFromCtx(ctx),
	)
	if err != nil {
		return fmt.Errorf("error updating ambient material: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("ambient material not found")
	}
	m.ID = id
	return nil
}

func (s *PostgresStore) DeactivateAmbientMaterial(ctx context.Context, id string) error {
	query := `UPDATE ambient_materials SET active = false WHERE id = $1 AND organization_id = $2;`
	_, err := s.db(ctx).Exec(ctx, query, id, OrgFromCtx(ctx))
	return err
}

func scanAmbientMaterial(r rowScanner) (domain.AmbientMaterial, error) {
	var m domain.AmbientMaterial
	var surfaceType string
	var categoryID *string
	var previewColor *string
	var previewTexture *string
	err := r.Scan(
		&m.ID, &m.Code, &m.Name, &m.Active, &surfaceType,
		&categoryID,
		&previewColor, &previewTexture,
		&m.PreviewTextureTileWidthMm, &m.PreviewTextureTileLengthMm,
		&m.PreviewRoughness, &m.PreviewMetalness, &m.PreviewClearcoat,
	)
	if err != nil {
		return m, err
	}
	m.SurfaceType = domain.AmbientSurfaceType(surfaceType)
	if categoryID != nil {
		m.CategoryID = *categoryID
	}
	if previewColor != nil {
		m.PreviewColor = *previewColor
	}
	if previewTexture != nil {
		m.PreviewTextureURL = *previewTexture
	}
	return m, nil
}
