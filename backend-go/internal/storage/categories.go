package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

func (s *PostgresStore) ListCategories(ctx context.Context) ([]domain.ModuleCategory, error) {
	query := `
		SELECT id, name, parent_id, sort_order, created_at, updated_at
		FROM module_categories
		ORDER BY sort_order ASC, name ASC;
	`
	rows, err := s.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.ModuleCategory
	for rows.Next() {
		var c domain.ModuleCategory
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
		list = []domain.ModuleCategory{}
	}
	return list, nil
}

func (s *PostgresStore) GetCategoryByID(ctx context.Context, id string) (*domain.ModuleCategory, error) {
	query := `
		SELECT id, name, parent_id, sort_order, created_at, updated_at
		FROM module_categories
		WHERE id = $1;
	`
	row := s.Pool.QueryRow(ctx, query, id)
	var c domain.ModuleCategory
	var parentID *string
	err := row.Scan(&c.ID, &c.Name, &parentID, &c.SortOrder, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if parentID != nil {
		c.ParentID = *parentID
	}
	return &c, nil
}

func (s *PostgresStore) CreateCategory(ctx context.Context, c *domain.ModuleCategory) error {
	all, err := s.ListCategories(ctx)
	if err != nil {
		return err
	}
	if err := domain.ValidateCategoryPlacement(c.ParentID, all, ""); err != nil {
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
			INSERT INTO module_categories (id, name, parent_id, sort_order)
			VALUES ($1, $2, $3, $4)
			RETURNING created_at, updated_at;
		`
		return s.Pool.QueryRow(ctx, query, c.ID, c.Name, parent, c.SortOrder).
			Scan(&c.CreatedAt, &c.UpdatedAt)
	}

	query := `
		INSERT INTO module_categories (name, parent_id, sort_order)
		VALUES ($1, $2, $3)
		RETURNING id, created_at, updated_at;
	`
	return s.Pool.QueryRow(ctx, query, c.Name, parent, c.SortOrder).
		Scan(&c.ID, &c.CreatedAt, &c.UpdatedAt)
}

func (s *PostgresStore) UpdateCategory(ctx context.Context, id string, c *domain.ModuleCategory) error {
	all, err := s.ListCategories(ctx)
	if err != nil {
		return err
	}
	if err := domain.ValidateCategoryPlacement(c.ParentID, all, id); err != nil {
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
		UPDATE module_categories
		SET name = $1, parent_id = $2, sort_order = $3, updated_at = CURRENT_TIMESTAMP
		WHERE id = $4
		RETURNING updated_at;
	`
	err = s.Pool.QueryRow(ctx, query, c.Name, parent, c.SortOrder, id).Scan(&c.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("category not found")
		}
		return err
	}
	c.ID = id
	return nil
}

func (s *PostgresStore) DeleteCategory(ctx context.Context, id string) error {
	// Children would violate RESTRICT — surface a clear error
	children, err := s.Pool.Query(ctx, `SELECT id FROM module_categories WHERE parent_id = $1 LIMIT 1`, id)
	if err != nil {
		return err
	}
	defer children.Close()
	if children.Next() {
		return fmt.Errorf("cannot delete category with children; reparent or delete children first")
	}

	_, err = s.Pool.Exec(ctx, `DELETE FROM module_categories WHERE id = $1`, id)
	return err
}
