package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// --- AGREGADOS (reusable sub-assemblies catalog entity) ---

func (s *PostgresStore) ListAgregados(ctx context.Context) ([]domain.Agregado, error) {
	query := `
		SELECT id, code, name, description, notes, width_mm, height_mm, depth_mm, components, hardware_lines, active, created_at, updated_at
		FROM agregados
		WHERE organization_id = $1
		ORDER BY name ASC;
	`
	rows, err := s.Pool.Query(ctx, query, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.Agregado
	for rows.Next() {
		a, err := scanAgregado(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, a)
	}
	if list == nil {
		list = []domain.Agregado{}
	}
	return list, rows.Err()
}

func (s *PostgresStore) GetAgregadoByID(ctx context.Context, id string) (*domain.Agregado, error) {
	query := `
		SELECT id, code, name, description, notes, width_mm, height_mm, depth_mm, components, hardware_lines, active, created_at, updated_at
		FROM agregados
		WHERE id = $1 AND organization_id = $2;
	`
	row := s.Pool.QueryRow(ctx, query, id, OrgFromCtx(ctx))
	a, err := scanAgregado(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("agregado not found")
		}
		return nil, err
	}
	return &a, nil
}

func (s *PostgresStore) CreateAgregado(ctx context.Context, a *domain.Agregado) error {
	componentsJSON, err := json.Marshal(a.Components)
	if err != nil {
		return fmt.Errorf("error marshaling agregado components: %w", err)
	}
	if len(componentsJSON) == 0 || string(componentsJSON) == "null" {
		componentsJSON = []byte("[]")
	}

	hwLinesJSON, err := json.Marshal(a.HardwareLines)
	if err != nil {
		return fmt.Errorf("error marshaling agregado hardware lines: %w", err)
	}
	if len(hwLinesJSON) == 0 || string(hwLinesJSON) == "null" {
		hwLinesJSON = []byte("[]")
	}

	query := `
		INSERT INTO agregados (id, code, name, description, notes, width_mm, height_mm, depth_mm, components, hardware_lines, active, organization_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);
	`
	_, err = s.Pool.Exec(ctx, query,
		a.ID, a.Code, a.Name, nullIfEmpty(a.Description), nullIfEmpty(a.Notes),
		a.WidthMm, a.HeightMm, a.DepthMm, componentsJSON, hwLinesJSON, a.Active, OrgFromCtx(ctx),
	)
	if err != nil {
		return fmt.Errorf("error creating agregado: %w", err)
	}
	return nil
}

func (s *PostgresStore) UpdateAgregado(ctx context.Context, id string, a *domain.Agregado) error {
	componentsJSON, err := json.Marshal(a.Components)
	if err != nil {
		return fmt.Errorf("error marshaling agregado components: %w", err)
	}
	if len(componentsJSON) == 0 || string(componentsJSON) == "null" {
		componentsJSON = []byte("[]")
	}

	hwLinesJSON, err := json.Marshal(a.HardwareLines)
	if err != nil {
		return fmt.Errorf("error marshaling agregado hardware lines: %w", err)
	}
	if len(hwLinesJSON) == 0 || string(hwLinesJSON) == "null" {
		hwLinesJSON = []byte("[]")
	}

	query := `
		UPDATE agregados
		SET code = $1, name = $2, description = $3, notes = $4, width_mm = $5, height_mm = $6, depth_mm = $7, components = $8, hardware_lines = $9, active = $10, updated_at = CURRENT_TIMESTAMP
		WHERE id = $11 AND organization_id = $12;
	`
	tag, err := s.Pool.Exec(ctx, query,
		a.Code, a.Name, nullIfEmpty(a.Description), nullIfEmpty(a.Notes),
		a.WidthMm, a.HeightMm, a.DepthMm, componentsJSON, hwLinesJSON, a.Active, id, OrgFromCtx(ctx),
	)
	if err != nil {
		return fmt.Errorf("error updating agregado: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("agregado not found")
	}
	a.ID = id
	return nil
}

func (s *PostgresStore) DeactivateAgregado(ctx context.Context, id string) error {
	query := `UPDATE agregados SET active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND organization_id = $2;`
	tag, err := s.Pool.Exec(ctx, query, id, OrgFromCtx(ctx))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("agregado not found")
	}
	return nil
}

// DeleteAgregado hard-deletes the row (F116 C4): the previous deactivate-only
// endpoint made every FE delete reappear on refresh, because saveCatalog is
// upsert-only and never issues DELETEs. Agregados are referenced by id inside
// modules.agregados / structures.agregados JSONB arrays — refuse while any
// instance still points at the row so BOM resolution stays sound.
func (s *PostgresStore) DeleteAgregado(ctx context.Context, id string) error {
	probe := fmt.Sprintf(`[{"agregado_id":%q}]`, id)
	const inUseQuery = `
		SELECT
			(SELECT count(*) FROM modules WHERE agregados @> $1::jsonb)
			+ (SELECT count(*) FROM structures WHERE agregados @> $1::jsonb);
	`
	var inUse int
	if err := s.Pool.QueryRow(ctx, inUseQuery, probe).Scan(&inUse); err != nil {
		return err
	}
	if inUse > 0 {
		return fmt.Errorf("agregado in use by %d módulo(s)/estructura(s)", inUse)
	}

	tag, err := s.Pool.Exec(ctx, `DELETE FROM agregados WHERE id = $1 AND organization_id = $2;`, id, OrgFromCtx(ctx))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("agregado not found")
	}
	return nil
}

func scanAgregado(r rowScanner) (domain.Agregado, error) {
	var a domain.Agregado
	var desc *string
	var notes *string
	var componentsRaw []byte
	var hwLinesRaw []byte
	err := r.Scan(
		&a.ID, &a.Code, &a.Name, &desc, &notes, &a.WidthMm, &a.HeightMm, &a.DepthMm, &componentsRaw, &hwLinesRaw, &a.Active,
		&a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		return a, err
	}
	if desc != nil {
		a.Description = *desc
	}
	if notes != nil {
		a.Notes = *notes
	}
	if len(componentsRaw) > 0 {
		_ = json.Unmarshal(componentsRaw, &a.Components)
	}
	if a.Components == nil {
		a.Components = []domain.ComponentInstance{}
	}
	if len(hwLinesRaw) > 0 {
		_ = json.Unmarshal(hwLinesRaw, &a.HardwareLines)
	}
	if a.HardwareLines == nil {
		a.HardwareLines = []domain.HardwareLine{}
	}
	return a, nil
}
