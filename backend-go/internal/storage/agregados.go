package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// --- AGREGADOS (reusable sub-assemblies catalog entity) ---

var (
	// ErrAgregadoNotFound is the typed not-found of the agregados catalog so
	// handlers can map it with errors.Is instead of matching the message text.
	// The text stays the historical one the delete SQL function also raises.
	ErrAgregadoNotFound = errors.New("agregado not found")
	// ErrAgregadoInUse: delete_catalog_agregado refuses to cascade while modules,
	// structures or published assembly snapshots still reference the agregado.
	// The wrapped message keeps the referencing count the function reports.
	ErrAgregadoInUse = errors.New("agregado in use")
)

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
			return nil, ErrAgregadoNotFound
		}
		return nil, err
	}
	return &a, nil
}

// agregadosWithRecipeQuery projects the catalog rows together with the JSONB
// recipe of the current revision in one statement (#1369). The LEFT JOIN keeps
// the recipe-less agregados (NULL current_revision_id) — a revision referenced
// but missing cannot exist (fk_agregados_current_revision) and would read as
// the same legitimate recipe-less case, never as an invented empty recipe.
const agregadosWithRecipeQuery = `
	SELECT a.id, a.code, a.name, a.description, a.notes, a.width_mm, a.height_mm, a.depth_mm,
	       a.components, a.hardware_lines, a.active, a.presentation_motion, a.current_revision_id,
	       a.created_at, a.updated_at, a.version,
	       r.recipe
	FROM agregados a
	LEFT JOIN agregado_revisions r
	       ON r.id = a.current_revision_id
	      AND r.organization_id = a.organization_id
	      AND r.agregado_id = a.id
`

// ListAgregadosWithRecipes lists the catalog rows with their current recipes
// in ONE tenant transaction (#1369): the list endpoint used to pay one
// runInTenantTx per agregado for the hydration. Errors map exactly like the
// single-row hydration did (#1399): no recipe → row as-is, real read failure
// (including a corrupt recipe JSONB) → the error propagates.
func (s *PostgresStore) ListAgregadosWithRecipes(ctx context.Context) ([]domain.Agregado, error) {
	return runInTenantTx(s, ctx, func(ctx context.Context) ([]domain.Agregado, error) {
		rows, err := s.db(ctx).Query(ctx, agregadosWithRecipeQuery+`
			WHERE a.organization_id = $1
			ORDER BY a.name ASC, a.id ASC;
		`, OrgFromCtx(ctx))
		if err != nil {
			return nil, err
		}
		defer rows.Close()

		var list []domain.Agregado
		for rows.Next() {
			a, err := scanAgregadoWithCurrentRecipe(rows)
			if err != nil {
				return nil, err
			}
			list = append(list, a)
		}
		if list == nil {
			list = []domain.Agregado{}
		}
		return list, rows.Err()
	})
}

// GetAgregadoByIDWithRecipe reads the agregado row and its current recipe in
// ONE tenant transaction (#1369): the separate row read + revision read let a
// concurrent PUT serve the old row with the new recipe. Not-found keeps the
// typed sentinel; recipe semantics are #1399's (see scanAgregadoWithCurrentRecipe).
func (s *PostgresStore) GetAgregadoByIDWithRecipe(ctx context.Context, id string) (*domain.Agregado, error) {
	return runInTenantTx(s, ctx, func(ctx context.Context) (*domain.Agregado, error) {
		row := s.db(ctx).QueryRow(ctx, agregadosWithRecipeQuery+`
			WHERE a.organization_id = $1 AND a.id = $2;
		`, OrgFromCtx(ctx), id)
		a, err := scanAgregadoWithCurrentRecipe(row)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrAgregadoNotFound
			}
			return nil, err
		}
		return &a, nil
	})
}

func (s *PostgresStore) CreateAgregado(ctx context.Context, a *domain.Agregado) error {
	// #1416: when the POST carries a recipe, persist it as revision 1 in the
	// SAME tenant transaction — before this, the API validated the recipe
	// (422 AGREGADO_RECIPE_INVALID since #1412) and then CreateAgregado
	// silently dropped it, so a created agregado was born blind. Legacy POSTs
	// without a recipe keep the exact previous behavior (no revision row; the
	// first PUT still allocates revision 1).
	if agregadoPostHasRecipe(a) {
		return s.createAgregadoWithRevision(ctx, a)
	}
	return s.insertAgregado(ctx, a)
}

func agregadoPostHasRecipe(a *domain.Agregado) bool {
	return len(a.RigidMembers) > 0 ||
		len(a.VariantSets) > 0 ||
		len(a.CompatibilityRules) > 0 ||
		(a.CommercialKitHardwareID != nil && *a.CommercialKitHardwareID != "")
}

func (s *PostgresStore) createAgregadoWithRevision(ctx context.Context, a *domain.Agregado) error {
	return runInTenantTxErr(s, ctx, func(ctx context.Context) error {
		if err := s.insertAgregado(ctx, a); err != nil {
			return err
		}
		rev, err := s.CreateAgregadoRevision(ctx, a.ID, a.ToRecipePayload(), nil)
		if err != nil {
			return fmt.Errorf("create agregado revision: %w", err)
		}
		return s.SetAgregadoCurrentRevision(ctx, a.ID, rev.ID)
	})
}

func (s *PostgresStore) insertAgregado(ctx context.Context, a *domain.Agregado) error {
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
		return s.disambiguateRowNotFound(ctx, "agregados", id, ErrAgregadoNotFound)
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
		return s.disambiguateRowNotFound(ctx, "agregados", id, ErrAgregadoNotFound)
	}
	return nil
}

// DeleteAgregado hard-deletes the row and its historical revisions through
// delete_catalog_agregado (#1168). Deleting an agregado with revisions
// previously failed with fk_agregado_revisions_agregado (ON DELETE RESTRICT)
// or composite FK nullification failures; the SECURITY DEFINER function
// safely cascades when the agregado is not in use by modules, structures, or
// published assembly snapshots.
func (s *PostgresStore) DeleteAgregado(ctx context.Context, id string, expectedVersion int64) error {
	_, err := s.db(ctx).Exec(ctx, `SELECT delete_catalog_agregado($1, $2);`, id, expectedVersion)
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "agregado not found") {
			return ErrAgregadoNotFound
		}
		if strings.Contains(msg, "agregado version conflict") {
			return ErrVersionConflict
		}
		if strings.Contains(msg, "agregado in use") {
			return fmt.Errorf("%w: %s", ErrAgregadoInUse, msg)
		}
		return err
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
	var s agregadoRowScan
	if err := r.Scan(s.dests()...); err != nil {
		return s.a, err
	}
	return s.finalize()
}

// agregadoRowScan carries the positional destinations of the agregados
// projection shared by every read so the plain and the recipe-hydrated
// (#1369) scans can never drift apart.
type agregadoRowScan struct {
	a                     domain.Agregado
	desc                  *string
	notes                 *string
	componentsRaw         []byte
	hwLinesRaw            []byte
	presentationMotionRaw []byte
}

func (s *agregadoRowScan) dests() []any {
	return []any{
		&s.a.ID, &s.a.Code, &s.a.Name, &s.desc, &s.notes,
		&s.a.WidthMm, &s.a.HeightMm, &s.a.DepthMm,
		&s.componentsRaw, &s.hwLinesRaw, &s.a.Active,
		&s.presentationMotionRaw, &s.a.CurrentRevisionID, &s.a.CreatedAt, &s.a.UpdatedAt,
		&s.a.Version,
	}
}

func (s *agregadoRowScan) finalize() (domain.Agregado, error) {
	a := &s.a
	if s.desc != nil {
		a.Description = *s.desc
	}
	if s.notes != nil {
		a.Notes = *s.notes
	}
	if len(s.componentsRaw) > 0 {
		_ = json.Unmarshal(s.componentsRaw, &a.Components)
	}
	if a.Components == nil {
		a.Components = []domain.ComponentInstance{}
	}
	if len(s.hwLinesRaw) > 0 {
		_ = json.Unmarshal(s.hwLinesRaw, &a.HardwareLines)
	}
	if a.HardwareLines == nil {
		a.HardwareLines = []domain.HardwareLine{}
	}
	// #529 presentation kinematics: jsonb guarantees valid JSON; a non-object
	// payload is an honest storage error, never silently dropped.
	if len(s.presentationMotionRaw) > 0 && string(s.presentationMotionRaw) != "null" {
		if err := json.Unmarshal(s.presentationMotionRaw, &a.PresentationMotion); err != nil {
			return *a, fmt.Errorf("decoding agregado presentation_motion: %w", err)
		}
	}
	return *a, nil
}

// scanAgregadoWithCurrentRecipe reads the agregados row plus the JSONB recipe
// of its current revision (LEFT JOIN, same row). #1399 semantics: no current
// revision is the legitimate recipe-less case and leaves the row as-is; any
// other failure — connection, a recipe JSONB that no longer unmarshals — is a
// real error and propagates (never a silently empty recipe).
func scanAgregadoWithCurrentRecipe(r rowScanner) (domain.Agregado, error) {
	var s agregadoRowScan
	var recipeRaw []byte
	dests := append(s.dests(), &recipeRaw)
	if err := r.Scan(dests...); err != nil {
		return s.a, err
	}
	a, err := s.finalize()
	if err != nil {
		return a, err
	}
	if len(recipeRaw) > 0 {
		var payload domain.AgregadoRecipePayload
		if err := json.Unmarshal(recipeRaw, &payload); err != nil {
			return a, fmt.Errorf("unmarshal agregado recipe: %w", err)
		}
		a.ApplyRecipe(payload)
	}
	return a, nil
}
