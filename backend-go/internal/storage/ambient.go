package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// --- AMBIENT MATERIALS (presentation-only floor/wall surfaces, #4150) ---
//
// Mirrors the material_boards store pattern (pgxpool, hand-written) minus the
// pricing/BOM columns — ambient materials carry only the preview_* subset.
// The preview_* numeric fields are *float64 so NULL (unset) stays distinct
// from 0 in the JSON contract the client optionalNum helper depends on.

func (s *PostgresStore) ListAmbientMaterials(ctx context.Context) ([]domain.AmbientMaterial, error) {
	query := `
		SELECT id, code, name, active, surface_type, preview_color, preview_texture_url, preview_texture_tile_width_mm, preview_texture_tile_length_mm, preview_roughness, preview_metalness, preview_clearcoat
		FROM ambient_materials
		ORDER BY name ASC;
	`
	rows, err := s.Pool.Query(ctx, query)
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
		SELECT id, code, name, active, surface_type, preview_color, preview_texture_url, preview_texture_tile_width_mm, preview_texture_tile_length_mm, preview_roughness, preview_metalness, preview_clearcoat
		FROM ambient_materials
		WHERE id = $1;
	`
	row := s.Pool.QueryRow(ctx, query, id)
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
	// Catalog entities always carry a client-minted id (the FE generates a
	// UUID before POST, same as material boards), so there is no server-side
	// id generation branch here. The NOT NULL id column surfaces an empty id
	// as a clear constraint violation instead of silently inventing one.
	query := `
		INSERT INTO ambient_materials (id, code, name, active, surface_type, preview_color, preview_texture_url, preview_texture_tile_width_mm, preview_texture_tile_length_mm, preview_roughness, preview_metalness, preview_clearcoat)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);
	`
	_, err := s.Pool.Exec(ctx, query,
		m.ID, m.Code, m.Name, m.Active, string(m.SurfaceType),
		nullIfEmpty(m.PreviewColor), nullIfEmpty(m.PreviewTextureURL),
		m.PreviewTextureTileWidthMm, m.PreviewTextureTileLengthMm,
		m.PreviewRoughness, m.PreviewMetalness, m.PreviewClearcoat,
	)
	if err != nil {
		return fmt.Errorf("error creating ambient material: %w", err)
	}
	return nil
}

func (s *PostgresStore) UpdateAmbientMaterial(ctx context.Context, id string, m *domain.AmbientMaterial) error {
	query := `
		UPDATE ambient_materials
		SET code = $1, name = $2, active = $3, surface_type = $4, preview_color = $5, preview_texture_url = $6, preview_texture_tile_width_mm = $7, preview_texture_tile_length_mm = $8, preview_roughness = $9, preview_metalness = $10, preview_clearcoat = $11
		WHERE id = $12;
	`
	tag, err := s.Pool.Exec(ctx, query,
		m.Code, m.Name, m.Active, string(m.SurfaceType),
		nullIfEmpty(m.PreviewColor), nullIfEmpty(m.PreviewTextureURL),
		m.PreviewTextureTileWidthMm, m.PreviewTextureTileLengthMm,
		m.PreviewRoughness, m.PreviewMetalness, m.PreviewClearcoat,
		id,
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
	query := `UPDATE ambient_materials SET active = false WHERE id = $1;`
	_, err := s.Pool.Exec(ctx, query, id)
	return err
}

// rowScanner abstracts pgx.Row and pgx.Rows so the ambient scan logic is shared
// between Get (single row) and List (cursor).
type rowScanner interface {
	Scan(dest ...any) error
}

func scanAmbientMaterial(r rowScanner) (domain.AmbientMaterial, error) {
	var m domain.AmbientMaterial
	var surfaceType string
	var previewColor *string
	var previewTexture *string
	err := r.Scan(
		&m.ID, &m.Code, &m.Name, &m.Active, &surfaceType,
		&previewColor, &previewTexture,
		&m.PreviewTextureTileWidthMm, &m.PreviewTextureTileLengthMm,
		&m.PreviewRoughness, &m.PreviewMetalness, &m.PreviewClearcoat,
	)
	if err != nil {
		return m, err
	}
	m.SurfaceType = domain.AmbientSurfaceType(surfaceType)
	if previewColor != nil {
		m.PreviewColor = *previewColor
	}
	if previewTexture != nil {
		m.PreviewTextureURL = *previewTexture
	}
	return m, nil
}
