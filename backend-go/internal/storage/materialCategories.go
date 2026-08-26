package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// --- MATERIAL CATEGORIES (F142: subgrupos de tableros) ---
//
// Mirror of the ambient_categories store (F086): pgxpool, hand-written
// queries, parents-before-children placement validation, physical delete
// guarded by children. material_boards.category_id FK is ON DELETE SET NULL.

func (s *PostgresStore) ListMaterialCategories(ctx context.Context) ([]domain.MaterialCategory, error) {
	query := `
		SELECT id, name, parent_id, sort_order, created_at, updated_at
		FROM material_categories
		WHERE organization_id = $1
		ORDER BY sort_order ASC, name ASC;
	`
	rows, err := s.Pool.Query(ctx, query, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.MaterialCategory
	for rows.Next() {
		var c domain.MaterialCategory
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
		list = []domain.MaterialCategory{}
	}
	return list, nil
}

func (s *PostgresStore) GetMaterialCategoryByID(ctx context.Context, id string) (*domain.MaterialCategory, error) {
	query := `
		SELECT id, name, parent_id, sort_order, created_at, updated_at
		FROM material_categories
		WHERE id = $1 AND organization_id = $2;
	`
	row := s.Pool.QueryRow(ctx, query, id, OrgFromCtx(ctx))
	var c domain.MaterialCategory
	var parentID *string
	err := row.Scan(&c.ID, &c.Name, &parentID, &c.SortOrder, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("material category not found")
		}
		return nil, err
	}
	if parentID != nil {
		c.ParentID = *parentID
	}
	return &c, nil
}

func (s *PostgresStore) CreateMaterialCategory(ctx context.Context, c *domain.MaterialCategory) error {
	all, err := s.ListMaterialCategories(ctx)
	if err != nil {
		return err
	}
	if err := domain.ValidateMaterialCategoryPlacement(c.ParentID, all, ""); err != nil {
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
			INSERT INTO material_categories (id, name, parent_id, sort_order, organization_id)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING created_at, updated_at;
		`
		return s.Pool.QueryRow(ctx, query, c.ID, c.Name, parent, c.SortOrder, OrgFromCtx(ctx)).
			Scan(&c.CreatedAt, &c.UpdatedAt)
	}

	query := `
		INSERT INTO material_categories (id, name, parent_id, sort_order, organization_id)
		VALUES (gen_random_uuid()::text, $1, $2, $3, $4)
		RETURNING id, created_at, updated_at;
	`
	return s.Pool.QueryRow(ctx, query, c.Name, parent, c.SortOrder, OrgFromCtx(ctx)).
		Scan(&c.ID, &c.CreatedAt, &c.UpdatedAt)
}

func (s *PostgresStore) UpdateMaterialCategory(ctx context.Context, id string, c *domain.MaterialCategory) error {
	all, err := s.ListMaterialCategories(ctx)
	if err != nil {
		return err
	}
	if err := domain.ValidateMaterialCategoryPlacement(c.ParentID, all, id); err != nil {
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
		UPDATE material_categories
		SET name = $1, parent_id = $2, sort_order = $3, updated_at = CURRENT_TIMESTAMP
		WHERE id = $4 AND organization_id = $5
		RETURNING updated_at;
	`
	err = s.Pool.QueryRow(ctx, query, c.Name, parent, c.SortOrder, id, OrgFromCtx(ctx)).Scan(&c.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("material category not found")
		}
		return err
	}
	c.ID = id
	return nil
}

func (s *PostgresStore) DeleteMaterialCategory(ctx context.Context, id string) error {
	children, err := s.Pool.Query(ctx, `SELECT id FROM material_categories WHERE parent_id = $1 AND organization_id = $2 LIMIT 1`, id, OrgFromCtx(ctx))
	if err != nil {
		return err
	}
	defer children.Close()
	if children.Next() {
		return fmt.Errorf("cannot delete category with children; reparent or delete children first")
	}

	_, err = s.Pool.Exec(ctx, `DELETE FROM material_categories WHERE id = $1 AND organization_id = $2`, id, OrgFromCtx(ctx))
	return err
}
