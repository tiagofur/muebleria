package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

func (s *PostgresStore) ListCategories(ctx context.Context) ([]domain.ModuleCategory, error) {
	// id is the final tiebreaker: duplicate (sort_order, name) rows — real
	// workshops create e.g. three "Puertas" — must never reorder between
	// reads or the content-addressed catalog revision oscillates and every
	// pinned client randomly answers CATALOG_REVISION_STALE.
	query := `
		SELECT id, name, parent_id, sort_order, created_at, updated_at, version
		FROM module_categories
		WHERE organization_id = $1
		ORDER BY sort_order ASC, name ASC, id ASC;
	`
	rows, err := s.db(ctx).Query(ctx, query, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.ModuleCategory
	for rows.Next() {
		var c domain.ModuleCategory
		var parentID *string
		err := rows.Scan(&c.ID, &c.Name, &parentID, &c.SortOrder, &c.CreatedAt, &c.UpdatedAt, &c.Version)
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
		SELECT id, name, parent_id, sort_order, created_at, updated_at, version
		FROM module_categories
		WHERE id = $1 AND organization_id = $2;
	`
	row := s.db(ctx).QueryRow(ctx, query, id, OrgFromCtx(ctx))
	var c domain.ModuleCategory
	var parentID *string
	err := row.Scan(&c.ID, &c.Name, &parentID, &c.SortOrder, &c.CreatedAt, &c.UpdatedAt, &c.Version)
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
			INSERT INTO module_categories (id, name, parent_id, sort_order, organization_id)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING created_at, updated_at, version;
		`
		return s.db(ctx).QueryRow(ctx, query, c.ID, c.Name, parent, c.SortOrder, OrgFromCtx(ctx)).
			Scan(&c.CreatedAt, &c.UpdatedAt, &c.Version)
	}

	query := `
		INSERT INTO module_categories (name, parent_id, sort_order, organization_id)
		VALUES ($1, $2, $3, $4)
		RETURNING id, created_at, updated_at, version;
	`
	return s.db(ctx).QueryRow(ctx, query, c.Name, parent, c.SortOrder, OrgFromCtx(ctx)).
		Scan(&c.ID, &c.CreatedAt, &c.UpdatedAt, &c.Version)
}

func (s *PostgresStore) UpdateCategory(ctx context.Context, id string, expectedVersion int64, c *domain.ModuleCategory) error {
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
		SET name = $1, parent_id = $2, sort_order = $3, updated_at = CURRENT_TIMESTAMP, version = version + 1
		WHERE id = $4 AND organization_id = $5 AND version = $6
		RETURNING updated_at, version;
	`
	err = s.db(ctx).QueryRow(ctx, query, c.Name, parent, c.SortOrder, id, OrgFromCtx(ctx), expectedVersion).Scan(&c.UpdatedAt, &c.Version)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return s.disambiguateRowNotFound(ctx, "module_categories", id, fmt.Errorf("category not found"))
		}
		return err
	}
	c.ID = id
	return nil
}

func (s *PostgresStore) DeleteCategory(ctx context.Context, id string, expectedVersion int64) error {
	// Children would violate RESTRICT — surface a clear error
	children, err := s.db(ctx).Query(ctx, `SELECT id FROM module_categories WHERE parent_id = $1 AND organization_id = $2 LIMIT 1`, id, OrgFromCtx(ctx))
	if err != nil {
		return err
	}
	defer children.Close()
	if children.Next() {
		return fmt.Errorf("cannot delete category with children; reparent or delete children first")
	}

	tag, err := s.db(ctx).Exec(ctx, `DELETE FROM module_categories WHERE id = $1 AND organization_id = $2 AND version = $3`, id, OrgFromCtx(ctx), expectedVersion)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return s.disambiguateRowNotFound(ctx, "module_categories", id, fmt.Errorf("category not found"))
	}
	return nil
}
