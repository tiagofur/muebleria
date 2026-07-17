package storage

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

func (s *PostgresStore) loadComponentParts(ctx context.Context, componentID string) ([]domain.BoardPart, error) {
	partsQuery := `
		SELECT id, code, description, quantity, length_mm, width_mm, option_role, edge_l1, edge_l2, edge_w1, edge_w2, length_formula, width_formula
		FROM component_board_parts
		WHERE component_id = $1
		ORDER BY code NULLS LAST, description;
	`
	pRows, err := s.Pool.Query(ctx, partsQuery, componentID)
	if err != nil {
		return nil, err
	}
	defer pRows.Close()

	var parts []domain.BoardPart
	for pRows.Next() {
		var p domain.BoardPart
		var code *string
		var lengthFormula, widthFormula *string
		var l1, l2, w1, w2 bool
		if err := pRows.Scan(&p.ID, &code, &p.Description, &p.Quantity, &p.LengthMm, &p.WidthMm, &p.OptionRole, &l1, &l2, &w1, &w2, &lengthFormula, &widthFormula); err != nil {
			return nil, err
		}
		if code != nil {
			p.Code = *code
		}
		if lengthFormula != nil {
			p.LengthFormula = *lengthFormula
		}
		if widthFormula != nil {
			p.WidthFormula = *widthFormula
		}
		p.Edges = edgesFromFlags(l1, l2, w1, w2)
		parts = append(parts, p)
	}
	if parts == nil {
		parts = []domain.BoardPart{}
	}
	return parts, pRows.Err()
}

func (s *PostgresStore) loadComponentHardware(ctx context.Context, componentID string) ([]domain.HardwareLine, error) {
	q := `
		SELECT id, quantity, description_override, option_role, hardware_id
		FROM component_hardware_lines
		WHERE component_id = $1;
	`
	rows, err := s.Pool.Query(ctx, q, componentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []domain.HardwareLine
	for rows.Next() {
		var hl domain.HardwareLine
		var desc *string
		var hwID *string
		if err := rows.Scan(&hl.ID, &hl.Quantity, &desc, &hl.OptionRole, &hwID); err != nil {
			return nil, err
		}
		if desc != nil {
			hl.DescriptionOverride = *desc
		}
		if hwID != nil {
			hl.HardwareID = *hwID
		}
		out = append(out, hl)
	}
	if out == nil {
		out = []domain.HardwareLine{}
	}
	return out, rows.Err()
}

func (s *PostgresStore) loadModuleComponentRefs(ctx context.Context, moduleID string) ([]domain.ModuleComponentRef, error) {
	q := `
		SELECT component_id, quantity
		FROM module_component_refs
		WHERE module_id = $1
		ORDER BY sort_order ASC, component_id ASC;
	`
	rows, err := s.Pool.Query(ctx, q, moduleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []domain.ModuleComponentRef
	for rows.Next() {
		var ref domain.ModuleComponentRef
		if err := rows.Scan(&ref.ComponentID, &ref.Quantity); err != nil {
			return nil, err
		}
		out = append(out, ref)
	}
	if out == nil {
		out = []domain.ModuleComponentRef{}
	}
	return out, rows.Err()
}

func replaceModuleComponentRefsTx(ctx context.Context, tx pgx.Tx, moduleID string, refs []domain.ModuleComponentRef) error {
	if _, err := tx.Exec(ctx, `DELETE FROM module_component_refs WHERE module_id = $1`, moduleID); err != nil {
		return err
	}
	for i, ref := range refs {
		if ref.ComponentID == "" || ref.Quantity < 1 {
			continue
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO module_component_refs (module_id, component_id, quantity, sort_order)
			VALUES ($1, $2, $3, $4);
		`, moduleID, ref.ComponentID, ref.Quantity, i); err != nil {
			return fmt.Errorf("error inserting module component ref: %w", err)
		}
	}
	return nil
}

func writeComponentChildren(ctx context.Context, tx pgx.Tx, componentID string, boardParts []domain.BoardPart, hardwareLines []domain.HardwareLine) error {
	for _, p := range boardParts {
		l1, l2, w1, w2 := edgeFlagsFromPart(p)
		partID := p.ID
		if !isValidUUID(partID) {
			partID = ""
		}
		var err error
		if partID != "" {
			_, err = tx.Exec(ctx, `
				INSERT INTO component_board_parts
				(id, component_id, code, description, quantity, length_mm, width_mm, option_role, edge_l1, edge_l2, edge_w1, edge_w2, length_formula, width_formula)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14);
			`, partID, componentID, nullIfEmpty(p.Code), p.Description, p.Quantity, p.LengthMm, p.WidthMm, p.OptionRole, l1, l2, w1, w2, nullIfEmpty(p.LengthFormula), nullIfEmpty(p.WidthFormula))
		} else {
			_, err = tx.Exec(ctx, `
				INSERT INTO component_board_parts
				(component_id, code, description, quantity, length_mm, width_mm, option_role, edge_l1, edge_l2, edge_w1, edge_w2, length_formula, width_formula)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13);
			`, componentID, nullIfEmpty(p.Code), p.Description, p.Quantity, p.LengthMm, p.WidthMm, p.OptionRole, l1, l2, w1, w2, nullIfEmpty(p.LengthFormula), nullIfEmpty(p.WidthFormula))
		}
		if err != nil {
			return fmt.Errorf("error inserting component part: %w", err)
		}
	}

	for _, hl := range hardwareLines {
		var hwID interface{}
		if hl.HardwareID != "" {
			hwID = hl.HardwareID
		}
		hlID := hl.ID
		if !isValidUUID(hlID) {
			hlID = ""
		}
		var err error
		if hlID != "" {
			_, err = tx.Exec(ctx, `
				INSERT INTO component_hardware_lines (id, component_id, quantity, description_override, option_role, hardware_id)
				VALUES ($1,$2,$3,$4,$5,$6);
			`, hlID, componentID, hl.Quantity, nullIfEmpty(hl.DescriptionOverride), hl.OptionRole, hwID)
		} else {
			_, err = tx.Exec(ctx, `
				INSERT INTO component_hardware_lines (component_id, quantity, description_override, option_role, hardware_id)
				VALUES ($1,$2,$3,$4,$5);
			`, componentID, hl.Quantity, nullIfEmpty(hl.DescriptionOverride), hl.OptionRole, hwID)
		}
		if err != nil {
			return fmt.Errorf("error inserting component hardware: %w", err)
		}
	}
	return nil
}

// ListFurnitureComponents returns all reusable components with parts and hardware (H06).
func (s *PostgresStore) ListFurnitureComponents(ctx context.Context) ([]domain.FurnitureComponent, error) {
	query := `
		SELECT id, code, name, kind, notes, active, created_at, updated_at
		FROM furniture_components
		ORDER BY name ASC;
	`
	rows, err := s.Pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("error query furniture_components: %w", err)
	}
	defer rows.Close()

	var out []domain.FurnitureComponent
	for rows.Next() {
		var c domain.FurnitureComponent
		var notes *string
		if err := rows.Scan(&c.ID, &c.Code, &c.Name, &c.Kind, &notes, &c.Active, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		if notes != nil {
			c.Notes = *notes
		}
		parts, err := s.loadComponentParts(ctx, c.ID)
		if err != nil {
			return nil, err
		}
		c.BoardParts = parts
		hw, err := s.loadComponentHardware(ctx, c.ID)
		if err != nil {
			return nil, err
		}
		c.HardwareLines = hw
		out = append(out, c)
	}
	if out == nil {
		out = []domain.FurnitureComponent{}
	}
	return out, rows.Err()
}

func (s *PostgresStore) GetFurnitureComponentByID(ctx context.Context, id string) (*domain.FurnitureComponent, error) {
	var c domain.FurnitureComponent
	var notes *string
	err := s.Pool.QueryRow(ctx, `
		SELECT id, code, name, kind, notes, active, created_at, updated_at
		FROM furniture_components WHERE id = $1;
	`, id).Scan(&c.ID, &c.Code, &c.Name, &c.Kind, &notes, &c.Active, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if notes != nil {
		c.Notes = *notes
	}
	parts, err := s.loadComponentParts(ctx, c.ID)
	if err != nil {
		return nil, err
	}
	c.BoardParts = parts
	hw, err := s.loadComponentHardware(ctx, c.ID)
	if err != nil {
		return nil, err
	}
	c.HardwareLines = hw
	return &c, nil
}

func (s *PostgresStore) CreateFurnitureComponent(ctx context.Context, c *domain.FurnitureComponent) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if c.Kind == "" {
		c.Kind = "otro"
	}
	c.Active = true

	if c.ID != "" {
		err = tx.QueryRow(ctx, `
			INSERT INTO furniture_components (id, code, name, kind, notes, active)
			VALUES ($1,$2,$3,$4,$5,$6)
			RETURNING created_at, updated_at;
		`, c.ID, c.Code, c.Name, c.Kind, nullIfEmpty(c.Notes), true).Scan(&c.CreatedAt, &c.UpdatedAt)
	} else {
		err = tx.QueryRow(ctx, `
			INSERT INTO furniture_components (code, name, kind, notes, active)
			VALUES ($1,$2,$3,$4,$5)
			RETURNING id, created_at, updated_at;
		`, c.Code, c.Name, c.Kind, nullIfEmpty(c.Notes), true).Scan(&c.ID, &c.CreatedAt, &c.UpdatedAt)
	}
	if err != nil {
		return fmt.Errorf("error inserting furniture component: %w", err)
	}

	if err := writeComponentChildren(ctx, tx, c.ID, c.BoardParts, c.HardwareLines); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *PostgresStore) UpdateFurnitureComponent(ctx context.Context, id string, c *domain.FurnitureComponent) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if c.Kind == "" {
		c.Kind = "otro"
	}

	tag, err := tx.Exec(ctx, `
		UPDATE furniture_components
		SET code = $1, name = $2, kind = $3, notes = $4, active = $5, updated_at = CURRENT_TIMESTAMP
		WHERE id = $6;
	`, c.Code, c.Name, c.Kind, nullIfEmpty(c.Notes), c.Active, id)
	if err != nil {
		return fmt.Errorf("error updating furniture component: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("component not found")
	}

	if _, err := tx.Exec(ctx, `DELETE FROM component_board_parts WHERE component_id = $1;`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM component_hardware_lines WHERE component_id = $1;`, id); err != nil {
		return err
	}

	if err := writeComponentChildren(ctx, tx, id, c.BoardParts, c.HardwareLines); err != nil {
		return err
	}
	c.ID = id
	return tx.Commit(ctx)
}

func (s *PostgresStore) DeleteFurnitureComponent(ctx context.Context, id string) error {
	tag, err := s.Pool.Exec(ctx, `DELETE FROM furniture_components WHERE id = $1;`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("component not found")
	}
	return nil
}
