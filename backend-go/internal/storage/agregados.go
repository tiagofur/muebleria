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
		SELECT id, code, name, description, notes, width_mm, height_mm, depth_mm, components, hardware_lines, active, presentation_motion, current_revision_id, created_at, updated_at, version
		FROM agregados
		WHERE organization_id = $1
		ORDER BY name ASC, id ASC;
	`
	rows, err := s.db(ctx).Query(ctx, query, OrgFromCtx(ctx))
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
		SELECT id, code, name, description, notes, width_mm, height_mm, depth_mm, components, hardware_lines, active, presentation_motion, current_revision_id, created_at, updated_at, version
		FROM agregados
		WHERE id = $1 AND organization_id = $2;
	`
	row := s.db(ctx).QueryRow(ctx, query, id, OrgFromCtx(ctx))
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

	presentationMotionJSON, err := marshalPresentationMotion(a.PresentationMotion)
	if err != nil {
		return fmt.Errorf("error marshaling agregado presentation motion: %w", err)
	}

	query := `
		INSERT INTO agregados (id, code, name, description, notes, width_mm, height_mm, depth_mm, components, hardware_lines, active, presentation_motion, organization_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		RETURNING version;
	`
	err = s.db(ctx).QueryRow(ctx, query,
		a.ID, a.Code, a.Name, nullIfEmpty(a.Description), nullIfEmpty(a.Notes),
		a.WidthMm, a.HeightMm, a.DepthMm, componentsJSON, hwLinesJSON, a.Active, presentationMotionJSON, OrgFromCtx(ctx),
	).Scan(&a.Version)
	if err != nil {
		return fmt.Errorf("error creating agregado: %w", err)
	}
	return nil
}

func (s *PostgresStore) UpdateAgregado(ctx context.Context, id string, expectedVersion int64, a *domain.Agregado) error {
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

	presentationMotionJSON, err := marshalPresentationMotion(a.PresentationMotion)
	if err != nil {
		return fmt.Errorf("error marshaling agregado presentation motion: %w", err)
	}

	query := `
		UPDATE agregados
		SET code = $1, name = $2, description = $3, notes = $4, width_mm = $5, height_mm = $6, depth_mm = $7, components = $8, hardware_lines = $9, active = $10, presentation_motion = $11, updated_at = CURRENT_TIMESTAMP, version = version + 1
		WHERE id = $12 AND organization_id = $13 AND version = $14;
	`
	tag, err := s.db(ctx).Exec(ctx, query,
		a.Code, a.Name, nullIfEmpty(a.Description), nullIfEmpty(a.Notes),
		a.WidthMm, a.HeightMm, a.DepthMm, componentsJSON, hwLinesJSON, a.Active, presentationMotionJSON, id, OrgFromCtx(ctx), expectedVersion,
	)
	if err != nil {
		return fmt.Errorf("error updating agregado: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return s.disambiguateRowNotFound(ctx, "agregados", id, fmt.Errorf("agregado not found"))
	}
	a.ID = id
	a.Version = expectedVersion + 1
	return nil
}

// UpdateAgregadoWithRevision performs the guarded catalog update and its
// audit revision in ONE tenant transaction (#1168): a failed revision rolls
// the update back too, so the revision trail can never lag the state it
// describes. The revision recipe is the freshly stored aggregate state.
func (s *PostgresStore) UpdateAgregadoWithRevision(ctx context.Context, id string, expectedVersion int64, a *domain.Agregado, createdBy *string) error {
	return runInTenantTxErr(s, ctx, func(ctx context.Context) error {
		if err := s.UpdateAgregado(ctx, id, expectedVersion, a); err != nil {
			return err
		}
		rev, err := s.CreateAgregadoRevision(ctx, id, a.ToRecipePayload(), createdBy)
		if err != nil {
			return fmt.Errorf("create agregado revision: %w", err)
		}
		return s.SetAgregadoCurrentRevision(ctx, id, rev.ID)
	})
}

func (s *PostgresStore) DeactivateAgregado(ctx context.Context, id string, expectedVersion int64) error {
	query := `UPDATE agregados SET active = false, updated_at = CURRENT_TIMESTAMP, version = version + 1 WHERE id = $1 AND organization_id = $2 AND version = $3;`
	tag, err := s.db(ctx).Exec(ctx, query, id, OrgFromCtx(ctx), expectedVersion)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return s.disambiguateRowNotFound(ctx, "agregados", id, fmt.Errorf("agregado not found"))
	}
	return nil
}

// DeleteAgregado hard-deletes the row (F116 C4): the previous deactivate-only
// endpoint made every FE delete reappear on refresh, because saveCatalog is
// upsert-only and never issues DELETEs. Agregados are referenced by id inside
// modules.agregados / structures.agregados JSONB arrays — refuse while any
// instance still points at the row so BOM resolution stays sound.
func (s *PostgresStore) DeleteAgregado(ctx context.Context, id string, expectedVersion int64) error {
	probe := fmt.Sprintf(`[{"agregado_id":%q}]`, id)
	const inUseQuery = `
		SELECT
			(SELECT count(*) FROM modules WHERE agregados @> $1::jsonb)
			+ (SELECT count(*) FROM structures WHERE agregados @> $1::jsonb);
	`
	var inUse int
	if err := s.db(ctx).QueryRow(ctx, inUseQuery, probe).Scan(&inUse); err != nil {
		return err
	}
	if inUse > 0 {
		return fmt.Errorf("agregado in use by %d módulo(s)/estructura(s)", inUse)
	}

	tag, err := s.db(ctx).Exec(ctx, `DELETE FROM agregados WHERE id = $1 AND organization_id = $2 AND version = $3;`, id, OrgFromCtx(ctx), expectedVersion)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return s.disambiguateRowNotFound(ctx, "agregados", id, fmt.Errorf("agregado not found"))
	}
	return nil
}

// marshalPresentationMotion maps a nil map to a NULL jsonb (absent
// presentation pose) and otherwise encodes the kinematics object (#529).
func marshalPresentationMotion(m map[string]any) ([]byte, error) {
	if len(m) == 0 {
		return nil, nil
	}
	return json.Marshal(m)
}

func scanAgregado(r rowScanner) (domain.Agregado, error) {
	var a domain.Agregado
	var desc *string
	var notes *string
	var componentsRaw []byte
	var hwLinesRaw []byte
	var presentationMotionRaw []byte
	err := r.Scan(
		&a.ID, &a.Code, &a.Name, &desc, &notes, &a.WidthMm, &a.HeightMm, &a.DepthMm, &componentsRaw, &hwLinesRaw, &a.Active,
		&presentationMotionRaw, &a.CurrentRevisionID, &a.CreatedAt, &a.UpdatedAt,
		&a.Version,
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
	// #529 presentation kinematics: jsonb guarantees valid JSON; a non-object
	// payload is an honest storage error, never silently dropped.
	if len(presentationMotionRaw) > 0 && string(presentationMotionRaw) != "null" {
		if err := json.Unmarshal(presentationMotionRaw, &a.PresentationMotion); err != nil {
			return a, fmt.Errorf("decoding agregado presentation_motion: %w", err)
		}
	}
	return a, nil
}
