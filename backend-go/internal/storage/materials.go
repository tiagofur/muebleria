package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// --- MATERIAL BOARDS ---

func nullableUUID(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func scanDefaultEdgeID(src *string) string {
	if src == nil {
		return ""
	}
	return *src
}

func (s *PostgresStore) GetMaterialBoardByID(ctx context.Context, id string) (*domain.MaterialBoard, error) {
	query := `
		SELECT id, code, name, width_mm, length_mm, thickness_mm, grain_default, board_price, waste_percent, cost_per_m2, default_edge_band_id, notes, active, created_at, updated_at
		FROM material_boards
		WHERE id = $1;
	`
	row := s.Pool.QueryRow(ctx, query, id)
	var m domain.MaterialBoard
	var notes *string
	var defaultEdge *string
	err := row.Scan(&m.ID, &m.Code, &m.Name, &m.WidthMm, &m.LengthMm, &m.ThicknessMm, &m.GrainDefault, &m.BoardPrice, &m.WastePercent, &m.CostPerM2, &defaultEdge, &notes, &m.Active, &m.CreatedAt, &m.UpdatedAt)
	if err != nil {
		return nil, err
	}
	m.DefaultEdgeBandID = scanDefaultEdgeID(defaultEdge)
	if notes != nil {
		m.Notes = *notes
	}
	return &m, nil
}

func (s *PostgresStore) CreateMaterialBoard(ctx context.Context, m *domain.MaterialBoard) error {
	// Prefer client-provided UUID so FE id stays stable across upserts.
	if m.ID != "" {
		query := `
			INSERT INTO material_boards (id, code, name, width_mm, length_mm, thickness_mm, grain_default, board_price, waste_percent, default_edge_band_id, notes, active)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
			RETURNING cost_per_m2, created_at, updated_at;
		`
		err := s.Pool.QueryRow(ctx, query, m.ID, m.Code, m.Name, m.WidthMm, m.LengthMm, m.ThicknessMm, m.GrainDefault, m.BoardPrice, m.WastePercent, nullableUUID(m.DefaultEdgeBandID), m.Notes, m.Active).
			Scan(&m.CostPerM2, &m.CreatedAt, &m.UpdatedAt)
		if err != nil {
			return fmt.Errorf("error creating material board: %w", err)
		}
		return nil
	}
	query := `
		INSERT INTO material_boards (code, name, width_mm, length_mm, thickness_mm, grain_default, board_price, waste_percent, default_edge_band_id, notes, active)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, cost_per_m2, created_at, updated_at;
	`
	err := s.Pool.QueryRow(ctx, query, m.Code, m.Name, m.WidthMm, m.LengthMm, m.ThicknessMm, m.GrainDefault, m.BoardPrice, m.WastePercent, nullableUUID(m.DefaultEdgeBandID), m.Notes, m.Active).
		Scan(&m.ID, &m.CostPerM2, &m.CreatedAt, &m.UpdatedAt)
	if err != nil {
		return fmt.Errorf("error creating material board: %w", err)
	}
	return nil
}

func (s *PostgresStore) UpdateMaterialBoard(ctx context.Context, id string, m *domain.MaterialBoard) error {
	query := `
		UPDATE material_boards
		SET code = $1, name = $2, width_mm = $3, length_mm = $4, thickness_mm = $5, grain_default = $6, board_price = $7, waste_percent = $8, default_edge_band_id = $9, notes = $10, active = $11, updated_at = CURRENT_TIMESTAMP
		WHERE id = $12
		RETURNING cost_per_m2, updated_at;
	`
	err := s.Pool.QueryRow(ctx, query, m.Code, m.Name, m.WidthMm, m.LengthMm, m.ThicknessMm, m.GrainDefault, m.BoardPrice, m.WastePercent, nullableUUID(m.DefaultEdgeBandID), m.Notes, m.Active, id).
		Scan(&m.CostPerM2, &m.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("material board not found")
		}
		return fmt.Errorf("error updating material board: %w", err)
	}
	m.ID = id
	return nil
}

func (s *PostgresStore) ListMaterialBoards(ctx context.Context) ([]domain.MaterialBoard, error) {
	query := `
		SELECT id, code, name, width_mm, length_mm, thickness_mm, grain_default, board_price, waste_percent, cost_per_m2, default_edge_band_id, notes, active, created_at, updated_at
		FROM material_boards
		ORDER BY name ASC;
	`
	rows, err := s.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.MaterialBoard
	for rows.Next() {
		var m domain.MaterialBoard
		var notes *string
		var defaultEdge *string
		err := rows.Scan(&m.ID, &m.Code, &m.Name, &m.WidthMm, &m.LengthMm, &m.ThicknessMm, &m.GrainDefault, &m.BoardPrice, &m.WastePercent, &m.CostPerM2, &defaultEdge, &notes, &m.Active, &m.CreatedAt, &m.UpdatedAt)
		if err != nil {
			return nil, err
		}
		m.DefaultEdgeBandID = scanDefaultEdgeID(defaultEdge)
		if notes != nil {
			m.Notes = *notes
		}
		list = append(list, m)
	}
	if list == nil {
		list = []domain.MaterialBoard{}
	}
	return list, nil
}

func (s *PostgresStore) DeactivateMaterialBoard(ctx context.Context, id string) error {
	query := `
		UPDATE material_boards
		SET active = false, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1;
	`
	_, err := s.Pool.Exec(ctx, query, id)
	return err
}

func (s *PostgresStore) ReactivateMaterialBoard(ctx context.Context, id string) error {
	query := `
		UPDATE material_boards
		SET active = true, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1;
	`
	_, err := s.Pool.Exec(ctx, query, id)
	return err
}

// --- EDGE BANDS ---

func (s *PostgresStore) ListEdgeBands(ctx context.Context) ([]domain.EdgeBand, error) {
	query := `
		SELECT id, code, name, thickness_mm, cost_per_ml, notes, active, created_at, updated_at
		FROM edge_bands
		ORDER BY name ASC;
	`
	rows, err := s.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.EdgeBand
	for rows.Next() {
		var e domain.EdgeBand
		var notes *string
		err := rows.Scan(&e.ID, &e.Code, &e.Name, &e.ThicknessMm, &e.CostPerMl, &notes, &e.Active, &e.CreatedAt, &e.UpdatedAt)
		if err != nil {
			return nil, err
		}
		if notes != nil {
			e.Notes = *notes
		}
		list = append(list, e)
	}
	if list == nil {
		list = []domain.EdgeBand{}
	}
	return list, nil
}

// --- HARDWARES ---

func (s *PostgresStore) ListHardwares(ctx context.Context) ([]domain.Hardware, error) {
	query := `
		SELECT id, code, name, unit, cost_per_unit, notes, active, created_at, updated_at
		FROM hardwares
		ORDER BY name ASC;
	`
	rows, err := s.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.Hardware
	for rows.Next() {
		var h domain.Hardware
		var notes *string
		err := rows.Scan(&h.ID, &h.Code, &h.Name, &h.Unit, &h.CostPerUnit, &notes, &h.Active, &h.CreatedAt, &h.UpdatedAt)
		if err != nil {
			return nil, err
		}
		if notes != nil {
			h.Notes = *notes
		}
		list = append(list, h)
	}
	if list == nil {
		list = []domain.Hardware{}
	}
	return list, nil
}

// --- OPTION GROUPS ---

func (s *PostgresStore) ListOptionGroups(ctx context.Context) ([]domain.OptionGroup, error) {
	query := `
		SELECT id, code, name, kind, required
		FROM option_groups
		ORDER BY name ASC;
	`
	rows, err := s.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.OptionGroup
	for rows.Next() {
		var og domain.OptionGroup
		err := rows.Scan(&og.ID, &og.Code, &og.Name, &og.Kind, &og.Required)
		if err != nil {
			return nil, err
		}

		// Cargar miembros
		memberQuery := `SELECT entity_id FROM option_group_members WHERE option_group_id = $1`
		mRows, err := s.Pool.Query(ctx, memberQuery, og.ID)
		if err != nil {
			return nil, err
		}
		// Nested cursor: defer immediately so early returns cannot leak (#17).
		func() {
			defer mRows.Close()
			for mRows.Next() {
				var eid string
				if err := mRows.Scan(&eid); err == nil {
					og.OptionIDs = append(og.OptionIDs, eid)
				}
			}
		}()
		if og.OptionIDs == nil {
			og.OptionIDs = []string{}
		}

		list = append(list, og)
	}
	if list == nil {
		list = []domain.OptionGroup{}
	}
	return list, nil
}

func (s *PostgresStore) GetEdgeBandByID(ctx context.Context, id string) (*domain.EdgeBand, error) {
	query := `
		SELECT id, code, name, thickness_mm, cost_per_ml, notes, active, created_at, updated_at
		FROM edge_bands
		WHERE id = $1;
	`
	row := s.Pool.QueryRow(ctx, query, id)
	var e domain.EdgeBand
	var notes *string
	err := row.Scan(&e.ID, &e.Code, &e.Name, &e.ThicknessMm, &e.CostPerMl, &notes, &e.Active, &e.CreatedAt, &e.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if notes != nil {
		e.Notes = *notes
	}
	return &e, nil
}

func (s *PostgresStore) CreateEdgeBand(ctx context.Context, e *domain.EdgeBand) error {
	if e.ID != "" {
		query := `
			INSERT INTO edge_bands (id, code, name, thickness_mm, cost_per_ml, notes, active)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING created_at, updated_at;
		`
		err := s.Pool.QueryRow(ctx, query, e.ID, e.Code, e.Name, e.ThicknessMm, e.CostPerMl, e.Notes, e.Active).
			Scan(&e.CreatedAt, &e.UpdatedAt)
		if err != nil {
			return fmt.Errorf("error creating edge band: %w", err)
		}
		return nil
	}
	query := `
		INSERT INTO edge_bands (code, name, thickness_mm, cost_per_ml, notes, active)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, created_at, updated_at;
	`
	err := s.Pool.QueryRow(ctx, query, e.Code, e.Name, e.ThicknessMm, e.CostPerMl, e.Notes, e.Active).
		Scan(&e.ID, &e.CreatedAt, &e.UpdatedAt)
	if err != nil {
		return fmt.Errorf("error creating edge band: %w", err)
	}
	return nil
}

func (s *PostgresStore) UpdateEdgeBand(ctx context.Context, id string, e *domain.EdgeBand) error {
	query := `
		UPDATE edge_bands
		SET code = $1, name = $2, thickness_mm = $3, cost_per_ml = $4, notes = $5, active = $6, updated_at = CURRENT_TIMESTAMP
		WHERE id = $7
		RETURNING updated_at;
	`
	err := s.Pool.QueryRow(ctx, query, e.Code, e.Name, e.ThicknessMm, e.CostPerMl, e.Notes, e.Active, id).
		Scan(&e.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("edge band not found")
		}
		return fmt.Errorf("error updating edge band: %w", err)
	}
	e.ID = id
	return nil
}

func (s *PostgresStore) DeactivateEdgeBand(ctx context.Context, id string) error {
	query := `UPDATE edge_bands SET active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1`
	_, err := s.Pool.Exec(ctx, query, id)
	return err
}

func (s *PostgresStore) ReactivateEdgeBand(ctx context.Context, id string) error {
	query := `UPDATE edge_bands SET active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1`
	_, err := s.Pool.Exec(ctx, query, id)
	return err
}

func (s *PostgresStore) GetHardwareByID(ctx context.Context, id string) (*domain.Hardware, error) {
	query := `
		SELECT id, code, name, unit, cost_per_unit, notes, active, created_at, updated_at
		FROM hardwares
		WHERE id = $1;
	`
	row := s.Pool.QueryRow(ctx, query, id)
	var h domain.Hardware
	var notes *string
	err := row.Scan(&h.ID, &h.Code, &h.Name, &h.Unit, &h.CostPerUnit, &notes, &h.Active, &h.CreatedAt, &h.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if notes != nil {
		h.Notes = *notes
	}
	return &h, nil
}

func (s *PostgresStore) CreateHardware(ctx context.Context, h *domain.Hardware) error {
	if h.ID != "" {
		query := `
			INSERT INTO hardwares (id, code, name, unit, cost_per_unit, notes, active)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING created_at, updated_at;
		`
		err := s.Pool.QueryRow(ctx, query, h.ID, h.Code, h.Name, h.Unit, h.CostPerUnit, h.Notes, h.Active).
			Scan(&h.CreatedAt, &h.UpdatedAt)
		if err != nil {
			return fmt.Errorf("error creating hardware: %w", err)
		}
		return nil
	}
	query := `
		INSERT INTO hardwares (code, name, unit, cost_per_unit, notes, active)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, created_at, updated_at;
	`
	err := s.Pool.QueryRow(ctx, query, h.Code, h.Name, h.Unit, h.CostPerUnit, h.Notes, h.Active).
		Scan(&h.ID, &h.CreatedAt, &h.UpdatedAt)
	if err != nil {
		return fmt.Errorf("error creating hardware: %w", err)
	}
	return nil
}

func (s *PostgresStore) UpdateHardware(ctx context.Context, id string, h *domain.Hardware) error {
	query := `
		UPDATE hardwares
		SET code = $1, name = $2, unit = $3, cost_per_unit = $4, notes = $5, active = $6, updated_at = CURRENT_TIMESTAMP
		WHERE id = $7
		RETURNING updated_at;
	`
	err := s.Pool.QueryRow(ctx, query, h.Code, h.Name, h.Unit, h.CostPerUnit, h.Notes, h.Active, id).
		Scan(&h.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("hardware not found")
		}
		return fmt.Errorf("error updating hardware: %w", err)
	}
	h.ID = id
	return nil
}

func (s *PostgresStore) DeactivateHardware(ctx context.Context, id string) error {
	query := `UPDATE hardwares SET active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1`
	_, err := s.Pool.Exec(ctx, query, id)
	return err
}

func (s *PostgresStore) ReactivateHardware(ctx context.Context, id string) error {
	query := `UPDATE hardwares SET active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1`
	_, err := s.Pool.Exec(ctx, query, id)
	return err
}

func (s *PostgresStore) GetOptionGroupByID(ctx context.Context, id string) (*domain.OptionGroup, error) {
	query := `
		SELECT id, code, name, kind, required
		FROM option_groups
		WHERE id = $1;
	`
	row := s.Pool.QueryRow(ctx, query, id)
	var og domain.OptionGroup
	err := row.Scan(&og.ID, &og.Code, &og.Name, &og.Kind, &og.Required)
	if err != nil {
		return nil, err
	}

	memberQuery := `SELECT entity_id FROM option_group_members WHERE option_group_id = $1`
	rows, err := s.Pool.Query(ctx, memberQuery, og.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var eid string
		if err := rows.Scan(&eid); err == nil {
			og.OptionIDs = append(og.OptionIDs, eid)
		}
	}
	return &og, nil
}

func (s *PostgresStore) CreateOptionGroup(ctx context.Context, og *domain.OptionGroup) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if og.ID != "" {
		query := `
			INSERT INTO option_groups (id, code, name, kind, required)
			VALUES ($1, $2, $3, $4, $5);
		`
		_, err = tx.Exec(ctx, query, og.ID, og.Code, og.Name, og.Kind, og.Required)
	} else {
		query := `
			INSERT INTO option_groups (code, name, kind, required)
			VALUES ($1, $2, $3, $4)
			RETURNING id;
		`
		err = tx.QueryRow(ctx, query, og.Code, og.Name, og.Kind, og.Required).Scan(&og.ID)
	}
	if err != nil {
		return fmt.Errorf("error creating option group: %w", err)
	}

	for _, eid := range og.OptionIDs {
		memberQuery := `INSERT INTO option_group_members (option_group_id, entity_id) VALUES ($1, $2)`
		_, err = tx.Exec(ctx, memberQuery, og.ID, eid)
		if err != nil {
			return fmt.Errorf("error inserting option group member: %w", err)
		}
	}

	return tx.Commit(ctx)
}

func (s *PostgresStore) UpdateOptionGroup(ctx context.Context, id string, og *domain.OptionGroup) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	query := `
		UPDATE option_groups
		SET code = $1, name = $2, kind = $3, required = $4
		WHERE id = $5
		RETURNING id;
	`
	err = tx.QueryRow(ctx, query, og.Code, og.Name, og.Kind, og.Required, id).Scan(&og.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("option group not found")
		}
		return fmt.Errorf("error updating option group: %w", err)
	}

	// Limpiar miembros anteriores
	_, err = tx.Exec(ctx, `DELETE FROM option_group_members WHERE option_group_id = $1`, id)
	if err != nil {
		return fmt.Errorf("error cleaning option group members: %w", err)
	}

	// Insertar nuevos miembros
	for _, eid := range og.OptionIDs {
		memberQuery := `INSERT INTO option_group_members (option_group_id, entity_id) VALUES ($1, $2)`
		_, err = tx.Exec(ctx, memberQuery, id, eid)
		if err != nil {
			return fmt.Errorf("error inserting option group member: %w", err)
		}
	}

	og.ID = id
	return tx.Commit(ctx)
}

func (s *PostgresStore) DeleteOptionGroup(ctx context.Context, id string) error {
	query := `DELETE FROM option_groups WHERE id = $1`
	_, err := s.Pool.Exec(ctx, query, id)
	return err
}

