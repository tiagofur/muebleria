package storage

import (
	"context"
	"fmt"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func edgesFromFlags(l1, l2, w1, w2 bool) []domain.EdgeAssignment {
	return []domain.EdgeAssignment{
		{Side: "L1", Enabled: l1},
		{Side: "L2", Enabled: l2},
		{Side: "W1", Enabled: w1},
		{Side: "W2", Enabled: w2},
	}
}

func edgeFlagsFromPart(p domain.BoardPart) (l1, l2, w1, w2 bool) {
	for _, e := range p.Edges {
		switch e.Side {
		case "L1":
			l1 = e.Enabled
		case "L2":
			l2 = e.Enabled
		case "W1":
			w1 = e.Enabled
		case "W2":
			w2 = e.Enabled
		}
	}
	return
}

func (s *PostgresStore) loadStructureParts(ctx context.Context, structureID string) ([]domain.BoardPart, error) {
	partsQuery := `
		SELECT id, code, description, quantity, length_mm, width_mm, option_role, edge_l1, edge_l2, edge_w1, edge_w2, length_formula, width_formula
		FROM structure_board_parts
		WHERE structure_id = $1
		ORDER BY code NULLS LAST, description;
	`
	pRows, err := s.Pool.Query(ctx, partsQuery, structureID)
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

func (s *PostgresStore) loadStructurePresets(ctx context.Context, structureID string) ([]domain.DimensionPreset, error) {
	presetsQuery := `
		SELECT id, name, width_mm, height_mm, depth_mm
		FROM structure_presets
		WHERE structure_id = $1
		ORDER BY width_mm ASC, height_mm ASC, depth_mm ASC;
	`
	rows, err := s.Pool.Query(ctx, presetsQuery, structureID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var presets []domain.DimensionPreset
	for rows.Next() {
		var pr domain.DimensionPreset
		var name *string
		if err := rows.Scan(&pr.ID, &name, &pr.WidthMm, &pr.HeightMm, &pr.DepthMm); err != nil {
			return nil, err
		}
		if name != nil {
			pr.Name = *name
		}
		presets = append(presets, pr)
	}
	if presets == nil {
		presets = []domain.DimensionPreset{}
	}
	return presets, rows.Err()
}

// ListStructures returns all engineering structures with board parts and presets (F049/F050).
func (s *PostgresStore) ListStructures(ctx context.Context) ([]domain.Structure, error) {
	query := `
		SELECT id, code, name, width_mm, height_mm, depth_mm, notes, active, created_at, updated_at
		FROM structures
		ORDER BY name ASC;
	`
	rows, err := s.Pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("error query structures: %w", err)
	}
	defer rows.Close()

	var out []domain.Structure
	for rows.Next() {
		var st domain.Structure
		var w, h, d *int
		var notes *string
		if err := rows.Scan(&st.ID, &st.Code, &st.Name, &w, &h, &d, &notes, &st.Active, &st.CreatedAt, &st.UpdatedAt); err != nil {
			return nil, err
		}
		if w != nil {
			st.WidthMm = *w
		}
		if h != nil {
			st.HeightMm = *h
		}
		if d != nil {
			st.DepthMm = *d
		}
		if notes != nil {
			st.Notes = *notes
		}
		parts, err := s.loadStructureParts(ctx, st.ID)
		if err != nil {
			return nil, err
		}
		st.BoardParts = parts

		presets, err := s.loadStructurePresets(ctx, st.ID)
		if err != nil {
			return nil, err
		}
		st.Presets = presets

		out = append(out, st)
	}
	if out == nil {
		out = []domain.Structure{}
	}
	return out, rows.Err()
}

func (s *PostgresStore) GetStructureByID(ctx context.Context, id string) (*domain.Structure, error) {
	query := `
		SELECT id, code, name, width_mm, height_mm, depth_mm, notes, active, created_at, updated_at
		FROM structures WHERE id = $1;
	`
	var st domain.Structure
	var w, h, d *int
	var notes *string
	err := s.Pool.QueryRow(ctx, query, id).Scan(
		&st.ID, &st.Code, &st.Name, &w, &h, &d, &notes, &st.Active, &st.CreatedAt, &st.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("structure not found: %w", err)
	}
	if w != nil {
		st.WidthMm = *w
	}
	if h != nil {
		st.HeightMm = *h
	}
	if d != nil {
		st.DepthMm = *d
	}
	if notes != nil {
		st.Notes = *notes
	}
	parts, err := s.loadStructureParts(ctx, st.ID)
	if err != nil {
		return nil, err
	}
	st.BoardParts = parts

	presets, err := s.loadStructurePresets(ctx, st.ID)
	if err != nil {
		return nil, err
	}
	st.Presets = presets

	return &st, nil
}

func nullIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

func (s *PostgresStore) CreateStructure(ctx context.Context, st *domain.Structure) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var w, h, d interface{}
	if st.WidthMm > 0 {
		w = st.WidthMm
	}
	if st.HeightMm > 0 {
		h = st.HeightMm
	}
	if st.DepthMm > 0 {
		d = st.DepthMm
	}
	active := true
	if st.Active {
		active = true
	}
	_ = st.Active
	active = true

	if st.ID != "" {
		err = tx.QueryRow(ctx, `
			INSERT INTO structures (id, code, name, width_mm, height_mm, depth_mm, notes, active)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
			RETURNING created_at, updated_at;
		`, st.ID, st.Code, st.Name, w, h, d, nullIfEmpty(st.Notes), active).Scan(&st.CreatedAt, &st.UpdatedAt)
	} else {
		err = tx.QueryRow(ctx, `
			INSERT INTO structures (code, name, width_mm, height_mm, depth_mm, notes, active)
			VALUES ($1,$2,$3,$4,$5,$6,$7)
			RETURNING id, created_at, updated_at;
		`, st.Code, st.Name, w, h, d, nullIfEmpty(st.Notes), active).Scan(&st.ID, &st.CreatedAt, &st.UpdatedAt)
	}
	if err != nil {
		return fmt.Errorf("error inserting structure: %w", err)
	}
	st.Active = active

	for _, p := range st.BoardParts {
		l1, l2, w1, w2 := edgeFlagsFromPart(p)
		if p.ID != "" {
			_, err = tx.Exec(ctx, `
				INSERT INTO structure_board_parts
				(id, structure_id, code, description, quantity, length_mm, width_mm, option_role, edge_l1, edge_l2, edge_w1, edge_w2, length_formula, width_formula)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14);
			`, p.ID, st.ID, nullIfEmpty(p.Code), p.Description, p.Quantity, p.LengthMm, p.WidthMm, p.OptionRole, l1, l2, w1, w2, nullIfEmpty(p.LengthFormula), nullIfEmpty(p.WidthFormula))
		} else {
			_, err = tx.Exec(ctx, `
				INSERT INTO structure_board_parts
				(structure_id, code, description, quantity, length_mm, width_mm, option_role, edge_l1, edge_l2, edge_w1, edge_w2, length_formula, width_formula)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13);
			`, st.ID, nullIfEmpty(p.Code), p.Description, p.Quantity, p.LengthMm, p.WidthMm, p.OptionRole, l1, l2, w1, w2, nullIfEmpty(p.LengthFormula), nullIfEmpty(p.WidthFormula))
		}
		if err != nil {
			return fmt.Errorf("error inserting structure part: %w", err)
		}
	}

	for _, pr := range st.Presets {
		if pr.ID != "" {
			_, err = tx.Exec(ctx, `
				INSERT INTO structure_presets (id, structure_id, name, width_mm, height_mm, depth_mm)
				VALUES ($1,$2,$3,$4,$5,$6);
			`, pr.ID, st.ID, nullIfEmpty(pr.Name), pr.WidthMm, pr.HeightMm, pr.DepthMm)
		} else {
			_, err = tx.Exec(ctx, `
				INSERT INTO structure_presets (structure_id, name, width_mm, height_mm, depth_mm)
				VALUES ($1,$2,$3,$4,$5);
			`, st.ID, nullIfEmpty(pr.Name), pr.WidthMm, pr.HeightMm, pr.DepthMm)
		}
		if err != nil {
			return fmt.Errorf("error inserting structure preset: %w", err)
		}
	}

	return tx.Commit(ctx)
}

func (s *PostgresStore) UpdateStructure(ctx context.Context, id string, st *domain.Structure) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var w, h, d interface{}
	if st.WidthMm > 0 {
		w = st.WidthMm
	}
	if st.HeightMm > 0 {
		h = st.HeightMm
	}
	if st.DepthMm > 0 {
		d = st.DepthMm
	}

	tag, err := tx.Exec(ctx, `
		UPDATE structures
		SET code = $1, name = $2, width_mm = $3, height_mm = $4, depth_mm = $5, notes = $6, active = $7, updated_at = CURRENT_TIMESTAMP
		WHERE id = $8;
	`, st.Code, st.Name, w, h, d, nullIfEmpty(st.Notes), st.Active, id)
	if err != nil {
		return fmt.Errorf("error updating structure: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("structure not found")
	}

	if _, err := tx.Exec(ctx, `DELETE FROM structure_board_parts WHERE structure_id = $1;`, id); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `DELETE FROM structure_presets WHERE structure_id = $1;`, id); err != nil {
		return err
	}

	for _, p := range st.BoardParts {
		l1, l2, w1, w2 := edgeFlagsFromPart(p)
		if p.ID != "" {
			_, err = tx.Exec(ctx, `
				INSERT INTO structure_board_parts
				(id, structure_id, code, description, quantity, length_mm, width_mm, option_role, edge_l1, edge_l2, edge_w1, edge_w2, length_formula, width_formula)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14);
			`, p.ID, id, nullIfEmpty(p.Code), p.Description, p.Quantity, p.LengthMm, p.WidthMm, p.OptionRole, l1, l2, w1, w2, nullIfEmpty(p.LengthFormula), nullIfEmpty(p.WidthFormula))
		} else {
			_, err = tx.Exec(ctx, `
				INSERT INTO structure_board_parts
				(structure_id, code, description, quantity, length_mm, width_mm, option_role, edge_l1, edge_l2, edge_w1, edge_w2, length_formula, width_formula)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13);
			`, id, nullIfEmpty(p.Code), p.Description, p.Quantity, p.LengthMm, p.WidthMm, p.OptionRole, l1, l2, w1, w2, nullIfEmpty(p.LengthFormula), nullIfEmpty(p.WidthFormula))
		}
		if err != nil {
			return fmt.Errorf("error replacing structure parts: %w", err)
		}
	}

	for _, pr := range st.Presets {
		if pr.ID != "" {
			_, err = tx.Exec(ctx, `
				INSERT INTO structure_presets (id, structure_id, name, width_mm, height_mm, depth_mm)
				VALUES ($1,$2,$3,$4,$5,$6);
			`, pr.ID, id, nullIfEmpty(pr.Name), pr.WidthMm, pr.HeightMm, pr.DepthMm)
		} else {
			_, err = tx.Exec(ctx, `
				INSERT INTO structure_presets (structure_id, name, width_mm, height_mm, depth_mm)
				VALUES ($1,$2,$3,$4,$5);
			`, id, nullIfEmpty(pr.Name), pr.WidthMm, pr.HeightMm, pr.DepthMm)
		}
		if err != nil {
			return fmt.Errorf("error replacing structure presets: %w", err)
		}
	}

	st.ID = id
	return tx.Commit(ctx)
}

func (s *PostgresStore) DeleteStructure(ctx context.Context, id string) error {
	tag, err := s.Pool.Exec(ctx, `DELETE FROM structures WHERE id = $1;`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("structure not found")
	}
	return nil
}
