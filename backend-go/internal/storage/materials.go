package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// --- Hardware part finishes (F080, JSONB column part_finishes) ---

// scanHardwarePartFinishes decodes the part_finishes JSONB column into the
// role→preset map. NULL / empty / invalid JSON → nil (global finish only).
func scanHardwarePartFinishes(raw []byte) map[string]string {
	if len(raw) == 0 {
		return nil
	}
	var out map[string]string
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// hardwarePartFinishesArg encodes the map for the JSONB column param; nil
// writes NULL (legacy rows keep no overrides).
func hardwarePartFinishesArg(m map[string]string) any {
	if len(m) == 0 {
		return nil
	}
	b, err := json.Marshal(m)
	if err != nil {
		return nil
	}
	return b
}

// --- Hardware machining profile (F127, JSONB column machining) ---

// scanHardwareMachining decodes the machining JSONB column. NULL / empty /
// invalid JSON → nil (cost-only hardware).
func scanHardwareMachining(raw []byte) *domain.HardwareMachiningProfile {
	if len(raw) == 0 {
		return nil
	}
	var out domain.HardwareMachiningProfile
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil
	}
	if len(out.Parts) == 0 {
		return nil
	}
	return &out
}

// hardwareMachiningArg encodes the profile for the JSONB column param; nil
// writes NULL (legacy rows keep no footprint).
func hardwareMachiningArg(p *domain.HardwareMachiningProfile) any {
	if p == nil || len(p.Parts) == 0 {
		return nil
	}
	b, err := json.Marshal(p)
	if err != nil {
		return nil
	}
	return b
}

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
		SELECT id, code, name, manufacturer, category_id, width_mm, length_mm, thickness_mm, grain_default, board_price, waste_percent, cost_per_m2, default_edge_band_id, image_url, preview_color, preview_texture_url, preview_texture_tile_width_mm, preview_texture_tile_length_mm, preview_roughness, preview_metalness, preview_clearcoat, notes, active, created_at, updated_at
		FROM material_boards
		WHERE id = $1 AND organization_id = $2;
	`
	row := s.Pool.QueryRow(ctx, query, id, OrgFromCtx(ctx))
	var m domain.MaterialBoard
	var notes *string
	var categoryID *string
	var defaultEdge *string
	var imageURL *string
	var previewColor *string
	var previewTexture *string
	var tileW *float64
	var tileL *float64
	err := row.Scan(&m.ID, &m.Code, &m.Name, &m.Manufacturer, &categoryID, &m.WidthMm, &m.LengthMm, &m.ThicknessMm, &m.GrainDefault, &m.BoardPrice, &m.WastePercent, &m.CostPerM2, &defaultEdge, &imageURL, &previewColor, &previewTexture, &tileW, &tileL, &m.PreviewRoughness, &m.PreviewMetalness, &m.PreviewClearcoat, &notes, &m.Active, &m.CreatedAt, &m.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if categoryID != nil {
		m.CategoryID = *categoryID
	}
	m.DefaultEdgeBandID = scanDefaultEdgeID(defaultEdge)
	if imageURL != nil {
		m.ImageURL = *imageURL
	}
	if previewColor != nil {
		m.PreviewColor = *previewColor
	}
	if previewTexture != nil {
		m.PreviewTextureURL = *previewTexture
	}
	if tileW != nil {
		m.PreviewTextureTileWidthMm = *tileW
	}
	if tileL != nil {
		m.PreviewTextureTileLengthMm = *tileL
	}
	if notes != nil {
		m.Notes = *notes
	}
	return &m, nil
}

func (s *PostgresStore) CreateMaterialBoard(ctx context.Context, m *domain.MaterialBoard) error {
	// Prefer client-provided UUID so FE id stays stable across upserts.
	if m.ID != "" {
		query := `
			INSERT INTO material_boards (id, code, name, manufacturer, category_id, width_mm, length_mm, thickness_mm, grain_default, board_price, waste_percent, default_edge_band_id, image_url, preview_color, preview_texture_url, preview_texture_tile_width_mm, preview_texture_tile_length_mm, preview_roughness, preview_metalness, preview_clearcoat, notes, active, organization_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
			RETURNING cost_per_m2, created_at, updated_at;
		`
		err := s.Pool.QueryRow(ctx, query, m.ID, m.Code, m.Name, m.Manufacturer, nullableUUID(m.CategoryID), m.WidthMm, m.LengthMm, m.ThicknessMm, m.GrainDefault, m.BoardPrice, m.WastePercent, nullableUUID(m.DefaultEdgeBandID), m.ImageURL, nullIfEmpty(m.PreviewColor), nullIfEmpty(m.PreviewTextureURL), nullIfZeroFloat(m.PreviewTextureTileWidthMm), nullIfZeroFloat(m.PreviewTextureTileLengthMm), m.PreviewRoughness, m.PreviewMetalness, m.PreviewClearcoat, m.Notes, m.Active, OrgFromCtx(ctx)).
			Scan(&m.CostPerM2, &m.CreatedAt, &m.UpdatedAt)
		if err != nil {
			return fmt.Errorf("error creating material board: %w", err)
		}
		return nil
	}
	query := `
		INSERT INTO material_boards (code, name, manufacturer, category_id, width_mm, length_mm, thickness_mm, grain_default, board_price, waste_percent, default_edge_band_id, image_url, preview_color, preview_texture_url, preview_texture_tile_width_mm, preview_texture_tile_length_mm, preview_roughness, preview_metalness, preview_clearcoat, notes, active, organization_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
		RETURNING id, cost_per_m2, created_at, updated_at;
	`
	err := s.Pool.QueryRow(ctx, query, m.Code, m.Name, m.Manufacturer, nullableUUID(m.CategoryID), m.WidthMm, m.LengthMm, m.ThicknessMm, m.GrainDefault, m.BoardPrice, m.WastePercent, nullableUUID(m.DefaultEdgeBandID), m.ImageURL, nullIfEmpty(m.PreviewColor), nullIfEmpty(m.PreviewTextureURL), nullIfZeroFloat(m.PreviewTextureTileWidthMm), nullIfZeroFloat(m.PreviewTextureTileLengthMm), m.PreviewRoughness, m.PreviewMetalness, m.PreviewClearcoat, m.Notes, m.Active, OrgFromCtx(ctx)).
		Scan(&m.ID, &m.CostPerM2, &m.CreatedAt, &m.UpdatedAt)
	if err != nil {
		return fmt.Errorf("error creating material board: %w", err)
	}
	return nil
}

func (s *PostgresStore) UpdateMaterialBoard(ctx context.Context, id string, m *domain.MaterialBoard) error {
	query := `
		UPDATE material_boards
		SET code = $1, name = $2, manufacturer = $3, category_id = $4, width_mm = $5, length_mm = $6, thickness_mm = $7, grain_default = $8, board_price = $9, waste_percent = $10, default_edge_band_id = $11, image_url = $12, preview_color = $13, preview_texture_url = $14, preview_texture_tile_width_mm = $15, preview_texture_tile_length_mm = $16, preview_roughness = $17, preview_metalness = $18, preview_clearcoat = $19, notes = $20, active = $21, updated_at = CURRENT_TIMESTAMP
		WHERE id = $22 AND organization_id = $23
		RETURNING cost_per_m2, updated_at;
	`
	err := s.Pool.QueryRow(ctx, query, m.Code, m.Name, m.Manufacturer, nullableUUID(m.CategoryID), m.WidthMm, m.LengthMm, m.ThicknessMm, m.GrainDefault, m.BoardPrice, m.WastePercent, nullableUUID(m.DefaultEdgeBandID), m.ImageURL, nullIfEmpty(m.PreviewColor), nullIfEmpty(m.PreviewTextureURL), nullIfZeroFloat(m.PreviewTextureTileWidthMm), nullIfZeroFloat(m.PreviewTextureTileLengthMm), m.PreviewRoughness, m.PreviewMetalness, m.PreviewClearcoat, m.Notes, m.Active, id, OrgFromCtx(ctx)).
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
		SELECT id, code, name, manufacturer, category_id, width_mm, length_mm, thickness_mm, grain_default, board_price, waste_percent, cost_per_m2, default_edge_band_id, image_url, preview_color, preview_texture_url, preview_texture_tile_width_mm, preview_texture_tile_length_mm, preview_roughness, preview_metalness, preview_clearcoat, notes, active, created_at, updated_at
		FROM material_boards
		WHERE organization_id = $1
		ORDER BY name ASC;
	`
	rows, err := s.Pool.Query(ctx, query, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.MaterialBoard
	for rows.Next() {
		var m domain.MaterialBoard
		var notes *string
		var categoryID *string
		var defaultEdge *string
		var imageURL *string
		var previewColor *string
		var previewTexture *string
		var tileW *float64
		var tileL *float64
		err := rows.Scan(&m.ID, &m.Code, &m.Name, &m.Manufacturer, &categoryID, &m.WidthMm, &m.LengthMm, &m.ThicknessMm, &m.GrainDefault, &m.BoardPrice, &m.WastePercent, &m.CostPerM2, &defaultEdge, &imageURL, &previewColor, &previewTexture, &tileW, &tileL, &m.PreviewRoughness, &m.PreviewMetalness, &m.PreviewClearcoat, &notes, &m.Active, &m.CreatedAt, &m.UpdatedAt)
		if err != nil {
			return nil, err
		}
		if categoryID != nil {
			m.CategoryID = *categoryID
		}
		m.DefaultEdgeBandID = scanDefaultEdgeID(defaultEdge)
		if imageURL != nil {
			m.ImageURL = *imageURL
		}
		if previewColor != nil {
			m.PreviewColor = *previewColor
		}
		if previewTexture != nil {
			m.PreviewTextureURL = *previewTexture
		}
		if tileW != nil {
			m.PreviewTextureTileWidthMm = *tileW
		}
		if tileL != nil {
			m.PreviewTextureTileLengthMm = *tileL
		}
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
		WHERE id = $1 AND organization_id = $2;
	`
	tag, err := s.Pool.Exec(ctx, query, id, OrgFromCtx(ctx))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("material board not found")
	}
	return nil
}

func (s *PostgresStore) ReactivateMaterialBoard(ctx context.Context, id string) error {
	query := `
		UPDATE material_boards
		SET active = true, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND organization_id = $2;
	`
	tag, err := s.Pool.Exec(ctx, query, id, OrgFromCtx(ctx))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("material board not found")
	}
	return nil
}

// --- EDGE BANDS ---

func (s *PostgresStore) ListEdgeBands(ctx context.Context) ([]domain.EdgeBand, error) {
	query := `
		SELECT id, code, name, thickness_mm, cost_per_ml, notes, preview_color, active, created_at, updated_at
		FROM edge_bands
		WHERE organization_id = $1
		ORDER BY name ASC;
	`
	rows, err := s.Pool.Query(ctx, query, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.EdgeBand
	for rows.Next() {
		var e domain.EdgeBand
		var notes *string
		err := rows.Scan(&e.ID, &e.Code, &e.Name, &e.ThicknessMm, &e.CostPerMl, &notes, &e.PreviewColor, &e.Active, &e.CreatedAt, &e.UpdatedAt)
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
		SELECT id, code, name, unit, cost_per_unit, package_size, image_url, preview_shape, preview_size_mm, preview_projection_mm, preview_diameter_mm, preview_color, preview_roughness, preview_metalness, preview_clearcoat, part_finishes, machining, notes, active, created_at, updated_at
		FROM hardwares
		WHERE organization_id = $1
		ORDER BY name ASC;
	`
	rows, err := s.Pool.Query(ctx, query, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.Hardware
	for rows.Next() {
		var h domain.Hardware
		var notes *string
		var imageURL *string
		var packageSize *float64
		var partFinishesRaw []byte
		var machiningRaw []byte
		err := rows.Scan(&h.ID, &h.Code, &h.Name, &h.Unit, &h.CostPerUnit, &packageSize, &imageURL, &h.PreviewShape, &h.PreviewSizeMm, &h.PreviewProjectionMm, &h.PreviewDiameterMm, &h.PreviewColor, &h.PreviewRoughness, &h.PreviewMetalness, &h.PreviewClearcoat, &partFinishesRaw, &machiningRaw, &notes, &h.Active, &h.CreatedAt, &h.UpdatedAt)
		if err != nil {
			return nil, err
		}
		if packageSize != nil {
			h.PackageSize = packageSize
		}
		if imageURL != nil {
			h.ImageURL = *imageURL
		}
		if notes != nil {
			h.Notes = *notes
		}
		h.PartFinishes = scanHardwarePartFinishes(partFinishesRaw)
		h.Machining = scanHardwareMachining(machiningRaw)
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
		WHERE organization_id = $1
		ORDER BY name ASC;
	`
	rows, err := s.Pool.Query(ctx, query, OrgFromCtx(ctx))
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
		SELECT id, code, name, thickness_mm, cost_per_ml, notes, preview_color, active, created_at, updated_at
		FROM edge_bands
		WHERE id = $1 AND organization_id = $2;
	`
	row := s.Pool.QueryRow(ctx, query, id, OrgFromCtx(ctx))
	var e domain.EdgeBand
	var notes *string
	err := row.Scan(&e.ID, &e.Code, &e.Name, &e.ThicknessMm, &e.CostPerMl, &notes, &e.PreviewColor, &e.Active, &e.CreatedAt, &e.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if notes != nil {
		e.Notes = *notes
	}
	return &e, nil
}

// edgeColorArg returns the preview color as a string arg (NULLIF handles the
// empty case — same pattern as material preview fields).
func edgeColorArg(e *domain.EdgeBand) string {
	if e.PreviewColor == nil {
		return ""
	}
	return *e.PreviewColor
}

func (s *PostgresStore) CreateEdgeBand(ctx context.Context, e *domain.EdgeBand) error {
	if e.ID != "" {
		query := `
			INSERT INTO edge_bands (id, code, name, thickness_mm, cost_per_ml, notes, preview_color, active, organization_id)
			VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), $8, $9)
			RETURNING created_at, updated_at;
		`
		err := s.Pool.QueryRow(ctx, query, e.ID, e.Code, e.Name, e.ThicknessMm, e.CostPerMl, e.Notes, edgeColorArg(e), e.Active, OrgFromCtx(ctx)).
			Scan(&e.CreatedAt, &e.UpdatedAt)
		if err != nil {
			return fmt.Errorf("error creating edge band: %w", err)
		}
		return nil
	}
	query := `
		INSERT INTO edge_bands (code, name, thickness_mm, cost_per_ml, notes, preview_color, active, organization_id)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), $7, $8)
		RETURNING id, created_at, updated_at;
	`
	err := s.Pool.QueryRow(ctx, query, e.Code, e.Name, e.ThicknessMm, e.CostPerMl, e.Notes, edgeColorArg(e), e.Active, OrgFromCtx(ctx)).
		Scan(&e.ID, &e.CreatedAt, &e.UpdatedAt)
	if err != nil {
		return fmt.Errorf("error creating edge band: %w", err)
	}
	return nil
}

func (s *PostgresStore) UpdateEdgeBand(ctx context.Context, id string, e *domain.EdgeBand) error {
	query := `
		UPDATE edge_bands
		SET code = $1, name = $2, thickness_mm = $3, cost_per_ml = $4, notes = $5, preview_color = NULLIF($6, ''), active = $7, updated_at = CURRENT_TIMESTAMP
		WHERE id = $8 AND organization_id = $9
		RETURNING updated_at;
	`
	err := s.Pool.QueryRow(ctx, query, e.Code, e.Name, e.ThicknessMm, e.CostPerMl, e.Notes, edgeColorArg(e), e.Active, id, OrgFromCtx(ctx)).
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
	query := `UPDATE edge_bands SET active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND organization_id = $2`
	tag, err := s.Pool.Exec(ctx, query, id, OrgFromCtx(ctx))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("edge band not found")
	}
	return nil
}

func (s *PostgresStore) ReactivateEdgeBand(ctx context.Context, id string) error {
	query := `UPDATE edge_bands SET active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND organization_id = $2`
	tag, err := s.Pool.Exec(ctx, query, id, OrgFromCtx(ctx))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("edge band not found")
	}
	return nil
}

func (s *PostgresStore) GetHardwareByID(ctx context.Context, id string) (*domain.Hardware, error) {
	query := `
		SELECT id, code, name, unit, cost_per_unit, package_size, image_url, preview_shape, preview_size_mm, preview_projection_mm, preview_diameter_mm, preview_color, preview_roughness, preview_metalness, preview_clearcoat, part_finishes, machining, notes, active, created_at, updated_at
		FROM hardwares
		WHERE id = $1 AND organization_id = $2;
	`
	row := s.Pool.QueryRow(ctx, query, id, OrgFromCtx(ctx))
	var h domain.Hardware
	var notes *string
	var imageURL *string
	var packageSize *float64
	var partFinishesRaw []byte
	var machiningRaw []byte
	err := row.Scan(&h.ID, &h.Code, &h.Name, &h.Unit, &h.CostPerUnit, &packageSize, &imageURL, &h.PreviewShape, &h.PreviewSizeMm, &h.PreviewProjectionMm, &h.PreviewDiameterMm, &h.PreviewColor, &h.PreviewRoughness, &h.PreviewMetalness, &h.PreviewClearcoat, &partFinishesRaw, &machiningRaw, &notes, &h.Active, &h.CreatedAt, &h.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if packageSize != nil {
		h.PackageSize = packageSize
	}
	if imageURL != nil {
		h.ImageURL = *imageURL
	}
	if notes != nil {
		h.Notes = *notes
	}
	h.PartFinishes = scanHardwarePartFinishes(partFinishesRaw)
	h.Machining = scanHardwareMachining(machiningRaw)
	return &h, nil
}

func (s *PostgresStore) CreateHardware(ctx context.Context, h *domain.Hardware) error {
	var pkg interface{}
	if h.PackageSize != nil {
		pkg = *h.PackageSize
	}
	if h.ID != "" {
		query := `
			INSERT INTO hardwares (id, code, name, unit, cost_per_unit, package_size, image_url, preview_shape, preview_size_mm, preview_projection_mm, preview_diameter_mm, preview_color, preview_roughness, preview_metalness, preview_clearcoat, part_finishes, machining, notes, active, organization_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
			RETURNING created_at, updated_at;
		`
		err := s.Pool.QueryRow(ctx, query, h.ID, h.Code, h.Name, h.Unit, h.CostPerUnit, pkg, h.ImageURL, h.PreviewShape, h.PreviewSizeMm, h.PreviewProjectionMm, h.PreviewDiameterMm, h.PreviewColor, h.PreviewRoughness, h.PreviewMetalness, h.PreviewClearcoat, hardwarePartFinishesArg(h.PartFinishes), hardwareMachiningArg(h.Machining), h.Notes, h.Active, OrgFromCtx(ctx)).
			Scan(&h.CreatedAt, &h.UpdatedAt)
		if err != nil {
			return fmt.Errorf("error creating hardware: %w", err)
		}
		return nil
	}
	query := `
		INSERT INTO hardwares (code, name, unit, cost_per_unit, package_size, image_url, preview_shape, preview_size_mm, preview_projection_mm, preview_diameter_mm, preview_color, preview_roughness, preview_metalness, preview_clearcoat, part_finishes, machining, notes, active, organization_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
		RETURNING id, created_at, updated_at;
	`
	err := s.Pool.QueryRow(ctx, query, h.Code, h.Name, h.Unit, h.CostPerUnit, pkg, h.ImageURL, h.PreviewShape, h.PreviewSizeMm, h.PreviewProjectionMm, h.PreviewDiameterMm, h.PreviewColor, h.PreviewRoughness, h.PreviewMetalness, h.PreviewClearcoat, hardwarePartFinishesArg(h.PartFinishes), hardwareMachiningArg(h.Machining), h.Notes, h.Active, OrgFromCtx(ctx)).
		Scan(&h.ID, &h.CreatedAt, &h.UpdatedAt)
	if err != nil {
		return fmt.Errorf("error creating hardware: %w", err)
	}
	return nil
}

func (s *PostgresStore) UpdateHardware(ctx context.Context, id string, h *domain.Hardware) error {
	var pkg interface{}
	if h.PackageSize != nil {
		pkg = *h.PackageSize
	}
	query := `
		UPDATE hardwares
		SET code = $1, name = $2, unit = $3, cost_per_unit = $4, package_size = $5, image_url = $6, preview_shape = $7, preview_size_mm = $8, preview_projection_mm = $9, preview_diameter_mm = $10, preview_color = $11, preview_roughness = $12, preview_metalness = $13, preview_clearcoat = $14, part_finishes = $15, machining = $16, notes = $17, active = $18, updated_at = CURRENT_TIMESTAMP
		WHERE id = $19 AND organization_id = $20
		RETURNING updated_at;
	`
	err := s.Pool.QueryRow(ctx, query, h.Code, h.Name, h.Unit, h.CostPerUnit, pkg, h.ImageURL, h.PreviewShape, h.PreviewSizeMm, h.PreviewProjectionMm, h.PreviewDiameterMm, h.PreviewColor, h.PreviewRoughness, h.PreviewMetalness, h.PreviewClearcoat, hardwarePartFinishesArg(h.PartFinishes), hardwareMachiningArg(h.Machining), h.Notes, h.Active, id, OrgFromCtx(ctx)).
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
	query := `UPDATE hardwares SET active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND organization_id = $2`
	tag, err := s.Pool.Exec(ctx, query, id, OrgFromCtx(ctx))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("hardware not found")
	}
	return nil
}

func (s *PostgresStore) ReactivateHardware(ctx context.Context, id string) error {
	query := `UPDATE hardwares SET active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND organization_id = $2`
	tag, err := s.Pool.Exec(ctx, query, id, OrgFromCtx(ctx))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("hardware not found")
	}
	return nil
}

func (s *PostgresStore) GetOptionGroupByID(ctx context.Context, id string) (*domain.OptionGroup, error) {
	query := `
		SELECT id, code, name, kind, required
		FROM option_groups
		WHERE id = $1 AND organization_id = $2;
	`
	row := s.Pool.QueryRow(ctx, query, id, OrgFromCtx(ctx))
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
			INSERT INTO option_groups (id, code, name, kind, required, organization_id)
			VALUES ($1, $2, $3, $4, $5, $6);
		`
		_, err = tx.Exec(ctx, query, og.ID, og.Code, og.Name, og.Kind, og.Required, OrgFromCtx(ctx))
	} else {
		query := `
			INSERT INTO option_groups (code, name, kind, required, organization_id)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING id;
		`
		err = tx.QueryRow(ctx, query, og.Code, og.Name, og.Kind, og.Required, OrgFromCtx(ctx)).Scan(&og.ID)
	}
	if err != nil {
		return fmt.Errorf("error creating option group: %w", err)
	}

	for _, eid := range og.OptionIDs {
		memberQuery := `INSERT INTO option_group_members (option_group_id, entity_id, organization_id) VALUES ($1, $2, $3)`
		_, err = tx.Exec(ctx, memberQuery, og.ID, eid, OrgFromCtx(ctx))
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
		WHERE id = $5 AND organization_id = $6
		RETURNING id;
	`
	err = tx.QueryRow(ctx, query, og.Code, og.Name, og.Kind, og.Required, id, OrgFromCtx(ctx)).Scan(&og.ID)
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
		memberQuery := `INSERT INTO option_group_members (option_group_id, entity_id, organization_id) VALUES ($1, $2, $3)`
		_, err = tx.Exec(ctx, memberQuery, id, eid, OrgFromCtx(ctx))
		if err != nil {
			return fmt.Errorf("error inserting option group member: %w", err)
		}
	}

	og.ID = id
	return tx.Commit(ctx)
}

func (s *PostgresStore) DeleteOptionGroup(ctx context.Context, id string) error {
	query := `DELETE FROM option_groups WHERE id = $1 AND organization_id = $2`
	tag, err := s.Pool.Exec(ctx, query, id, OrgFromCtx(ctx))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("option group not found")
	}
	return nil
}
