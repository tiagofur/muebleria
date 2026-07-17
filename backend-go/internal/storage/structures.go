package storage

import (
	"context"
	"fmt"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func (s *PostgresStore) loadStructureComponents(ctx context.Context, structureID string) ([]domain.ComponentInstance, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT component_id, quantity, placement_override
		FROM structure_components
		WHERE structure_id = $1
		ORDER BY created_at ASC;
	`, structureID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []domain.ComponentInstance
	for rows.Next() {
		var ci domain.ComponentInstance
		var placementOverride *string
		if err := rows.Scan(&ci.ComponentID, &ci.Quantity, &placementOverride); err != nil {
			return nil, err
		}
		if placementOverride != nil && *placementOverride != "" {
			p := domain.ComponentPlacement(*placementOverride)
			ci.PlacementOverride = &p
		}
		out = append(out, ci)
	}
	if out == nil {
		out = []domain.ComponentInstance{}
	}
	return out, rows.Err()
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

// ListStructures returns all engineering structures with their component
// instances and measure presets (F049/F053). Since F053 structures compose
// reusable Component instances instead of carrying their own board parts.
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
		components, err := s.loadStructureComponents(ctx, st.ID)
		if err != nil {
			return nil, err
		}
		st.Components = components

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
	components, err := s.loadStructureComponents(ctx, st.ID)
	if err != nil {
		return nil, err
	}
	st.Components = components

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

func placementOverrideArg(p *domain.ComponentPlacement) interface{} {
	if p == nil {
		return nil
	}
	return string(*p)
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
	// New structures are always created active — consistent with every other
	// catalog entity (handlers POST create as active; deactivation is via PUT).
	active := true

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

	for _, c := range st.Components {
		_, err = tx.Exec(ctx, `
			INSERT INTO structure_components (structure_id, component_id, quantity, placement_override)
			VALUES ($1,$2,$3,$4);
		`, st.ID, c.ComponentID, c.Quantity, placementOverrideArg(c.PlacementOverride))
		if err != nil {
			return fmt.Errorf("error inserting structure component: %w", err)
		}
	}

	for _, pr := range st.Presets {
		presetID := pr.ID
		if !isValidUUID(presetID) {
			presetID = ""
		}
		if presetID != "" {
			_, err = tx.Exec(ctx, `
				INSERT INTO structure_presets (id, structure_id, name, width_mm, height_mm, depth_mm)
				VALUES ($1,$2,$3,$4,$5,$6);
			`, presetID, st.ID, nullIfEmpty(pr.Name), pr.WidthMm, pr.HeightMm, pr.DepthMm)
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

	if _, err := tx.Exec(ctx, `DELETE FROM structure_presets WHERE structure_id = $1;`, id); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `DELETE FROM structure_components WHERE structure_id = $1;`, id); err != nil {
		return err
	}

	for _, c := range st.Components {
		_, err = tx.Exec(ctx, `
			INSERT INTO structure_components (structure_id, component_id, quantity, placement_override)
			VALUES ($1,$2,$3,$4);
		`, id, c.ComponentID, c.Quantity, placementOverrideArg(c.PlacementOverride))
		if err != nil {
			return fmt.Errorf("error replacing structure component: %w", err)
		}
	}

	for _, pr := range st.Presets {
		presetID := pr.ID
		if !isValidUUID(presetID) {
			presetID = ""
		}
		if presetID != "" {
			_, err = tx.Exec(ctx, `
				INSERT INTO structure_presets (id, structure_id, name, width_mm, height_mm, depth_mm)
				VALUES ($1,$2,$3,$4,$5,$6);
			`, presetID, id, nullIfEmpty(pr.Name), pr.WidthMm, pr.HeightMm, pr.DepthMm)
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

func isValidUUID(id string) bool {
	if len(id) != 36 {
		return false
	}
	return id[8] == '-' && id[13] == '-' && id[18] == '-' && id[23] == '-'
}
