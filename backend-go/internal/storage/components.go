package storage

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// --- COMPONENTS (F050 / #101) ---

func (s *PostgresStore) ListComponents(ctx context.Context) ([]domain.Component, error) {
	query := `
		SELECT id, code, name, placement, geometry_kind, length_mm, width_mm, thickness_mm,
		       default_edges, option_roles, length_formula, width_formula,
		       x_formula, y_formula, z_formula, rotate_x, rotate_y, rotate_z,
		       notes, active, created_at, updated_at
		FROM components
		ORDER BY name ASC;
	`
	rows, err := s.Pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("error query components: %w", err)
	}
	defer rows.Close()

	var out []domain.Component
	for rows.Next() {
		var c domain.Component
		var notes *string
		var lengthFormula, widthFormula *string
		var xFormula, yFormula, zFormula *string
		if err := rows.Scan(
			&c.ID, &c.Code, &c.Name, &c.Placement, &c.GeometryKind,
			&c.LengthMm, &c.WidthMm, &c.ThicknessMm,
			&c.DefaultEdges, &c.OptionRoles, &lengthFormula, &widthFormula,
			&xFormula, &yFormula, &zFormula, &c.RotateX, &c.RotateY, &c.RotateZ,
			&notes, &c.Active, &c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if notes != nil {
			c.Notes = *notes
		}
		if lengthFormula != nil {
			c.LengthFormula = *lengthFormula
		}
		if widthFormula != nil {
			c.WidthFormula = *widthFormula
		}
		if xFormula != nil {
			c.XFormula = *xFormula
		}
		if yFormula != nil {
			c.YFormula = *yFormula
		}
		if zFormula != nil {
			c.ZFormula = *zFormula
		}
		out = append(out, c)
	}
	if out == nil {
		out = []domain.Component{}
	}
	return out, rows.Err()
}

func (s *PostgresStore) GetComponentByID(ctx context.Context, id string) (*domain.Component, error) {
	query := `
		SELECT id, code, name, placement, geometry_kind, length_mm, width_mm, thickness_mm,
		       default_edges, option_roles, length_formula, width_formula,
		       x_formula, y_formula, z_formula, rotate_x, rotate_y, rotate_z,
		       notes, active, created_at, updated_at
		FROM components WHERE id = $1;
	`
	var c domain.Component
	var notes *string
	var lengthFormula, widthFormula *string
	var xFormula, yFormula, zFormula *string
	err := s.Pool.QueryRow(ctx, query, id).Scan(
		&c.ID, &c.Code, &c.Name, &c.Placement, &c.GeometryKind,
		&c.LengthMm, &c.WidthMm, &c.ThicknessMm,
		&c.DefaultEdges, &c.OptionRoles, &lengthFormula, &widthFormula,
		&xFormula, &yFormula, &zFormula, &c.RotateX, &c.RotateY, &c.RotateZ,
		&notes, &c.Active, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("component not found: %w", err)
	}
	if notes != nil {
		c.Notes = *notes
	}
	if lengthFormula != nil {
		c.LengthFormula = *lengthFormula
	}
	if widthFormula != nil {
		c.WidthFormula = *widthFormula
	}
	if xFormula != nil {
		c.XFormula = *xFormula
	}
	if yFormula != nil {
		c.YFormula = *yFormula
	}
	if zFormula != nil {
		c.ZFormula = *zFormula
	}
	return &c, nil
}

func (s *PostgresStore) CreateComponent(ctx context.Context, c *domain.Component) error {
	edgesJSON, err := json.Marshal(c.DefaultEdges)
	if err != nil {
		return fmt.Errorf("marshaling default_edges: %w", err)
	}

	if c.ID != "" {
		err = s.Pool.QueryRow(ctx, `
			INSERT INTO components (id, code, name, placement, geometry_kind, length_mm, width_mm, thickness_mm, default_edges, option_roles, length_formula, width_formula, x_formula, y_formula, z_formula, rotate_x, rotate_y, rotate_z, notes, active)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
			RETURNING created_at, updated_at;
		`, c.ID, c.Code, c.Name, c.Placement, c.GeometryKind,
			c.LengthMm, c.WidthMm, c.ThicknessMm, edgesJSON,
			c.OptionRoles, nullIfEmpty(c.LengthFormula), nullIfEmpty(c.WidthFormula),
			nullIfEmpty(c.XFormula), nullIfEmpty(c.YFormula), nullIfEmpty(c.ZFormula),
			c.RotateX, c.RotateY, c.RotateZ,
			nullIfEmpty(c.Notes), c.Active,
		).Scan(&c.CreatedAt, &c.UpdatedAt)
	} else {
		err = s.Pool.QueryRow(ctx, `
			INSERT INTO components (code, name, placement, geometry_kind, length_mm, width_mm, thickness_mm, default_edges, option_roles, length_formula, width_formula, x_formula, y_formula, z_formula, rotate_x, rotate_y, rotate_z, notes, active)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
			RETURNING id, created_at, updated_at;
		`, c.Code, c.Name, c.Placement, c.GeometryKind,
			c.LengthMm, c.WidthMm, c.ThicknessMm, edgesJSON,
			c.OptionRoles, nullIfEmpty(c.LengthFormula), nullIfEmpty(c.WidthFormula),
			nullIfEmpty(c.XFormula), nullIfEmpty(c.YFormula), nullIfEmpty(c.ZFormula),
			c.RotateX, c.RotateY, c.RotateZ,
			nullIfEmpty(c.Notes), c.Active,
		).Scan(&c.ID, &c.CreatedAt, &c.UpdatedAt)
	}
	if err != nil {
		return fmt.Errorf("error inserting component: %w", err)
	}
	return nil
}

func (s *PostgresStore) UpdateComponent(ctx context.Context, id string, c *domain.Component) error {
	edgesJSON, err := json.Marshal(c.DefaultEdges)
	if err != nil {
		return fmt.Errorf("marshaling default_edges: %w", err)
	}

	tag, err := s.Pool.Exec(ctx, `
		UPDATE components
		SET code = $1, name = $2, placement = $3, geometry_kind = $4,
		    length_mm = $5, width_mm = $6, thickness_mm = $7,
		    default_edges = $8, option_roles = $9, length_formula = $10, width_formula = $11,
		    x_formula = $12, y_formula = $13, z_formula = $14,
		    rotate_x = $15, rotate_y = $16, rotate_z = $17,
		    notes = $18, active = $19,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $20;
	`, c.Code, c.Name, c.Placement, c.GeometryKind,
		c.LengthMm, c.WidthMm, c.ThicknessMm, edgesJSON,
		c.OptionRoles, nullIfEmpty(c.LengthFormula), nullIfEmpty(c.WidthFormula),
		nullIfEmpty(c.XFormula), nullIfEmpty(c.YFormula), nullIfEmpty(c.ZFormula),
		c.RotateX, c.RotateY, c.RotateZ,
		nullIfEmpty(c.Notes), c.Active, id)
	if err != nil {
		return fmt.Errorf("error updating component: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("component not found")
	}
	c.ID = id
	return nil
}

func (s *PostgresStore) DeleteComponent(ctx context.Context, id string) error {
	tag, err := s.Pool.Exec(ctx, `DELETE FROM components WHERE id = $1;`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("component not found")
	}
	return nil
}
