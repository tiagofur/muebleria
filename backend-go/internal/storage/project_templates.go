package storage

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// --- Project templates CRUD (#110 / H15) ---
//
// Templates are stored in a dedicated table; items + nested JSON blobs
// (measure_defaults / kitchen_layout / installation_checklist) are JSONB
// columns. The clone logic that turns a template into a draft Project lives in
// the TS domain; Go only persists CRUD.

// ListProjectTemplates returns all templates ordered by name.
func (s *PostgresStore) ListProjectTemplates(ctx context.Context) ([]domain.ProjectTemplate, error) {
	query := `
		SELECT id, name, currency, margin_factor, labor_fixed_cost,
		       project_level_choices, measure_defaults, kitchen_layout,
		       installation_checklist, items, notes, created_at, updated_at
		FROM project_templates
		WHERE organization_id = $1
		ORDER BY name ASC;
	`
	rows, err := s.db(ctx).Query(ctx, query, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.ProjectTemplate
	for rows.Next() {
		t, err := scanProjectTemplate(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, t)
	}
	return list, nil
}

// GetProjectTemplateByID returns one template by id.
func (s *PostgresStore) GetProjectTemplateByID(ctx context.Context, id string) (*domain.ProjectTemplate, error) {
	query := `
		SELECT id, name, currency, margin_factor, labor_fixed_cost,
		       project_level_choices, measure_defaults, kitchen_layout,
		       installation_checklist, items, notes, created_at, updated_at
		FROM project_templates
		WHERE id = $1 AND organization_id = $2;
	`
	row := s.db(ctx).QueryRow(ctx, query, id, OrgFromCtx(ctx))
	t, err := scanProjectTemplate(row)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// CreateProjectTemplate inserts a new template.
func (s *PostgresStore) CreateProjectTemplate(ctx context.Context, t domain.ProjectTemplate) error {
	itemsJSON, err := itemsToJSONB(t.Items)
	if err != nil {
		return fmt.Errorf("marshal template items: %w", err)
	}
	query := `
		INSERT INTO project_templates (id, name, currency, margin_factor, labor_fixed_cost,
		                               project_level_choices, measure_defaults, kitchen_layout,
		                               installation_checklist, items, notes, created_at, updated_at, organization_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		RETURNING created_at, updated_at;
	`
	err = s.db(ctx).QueryRow(ctx, query,
		t.ID, t.Name, t.Currency, t.MarginFactor, t.LaborFixedCost,
		choicesToJSONB(t.ProjectLevelChoices),
		rawJSONB(t.MeasureDefaults),
		rawJSONB(t.KitchenLayout),
		rawJSONB(t.InstallationChecklist),
		itemsJSON,
		nullableString(t.Notes),
		t.CreatedAt, t.UpdatedAt,
		OrgFromCtx(ctx),
	).Scan(&t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return fmt.Errorf("create project template: %w", err)
	}
	return nil
}

// UpdateProjectTemplate upserts a template by id.
func (s *PostgresStore) UpdateProjectTemplate(ctx context.Context, id string, t domain.ProjectTemplate) error {
	itemsJSON, err := itemsToJSONB(t.Items)
	if err != nil {
		return fmt.Errorf("marshal template items: %w", err)
	}
	query := `
		UPDATE project_templates
		SET name = $1, currency = $2, margin_factor = $3, labor_fixed_cost = $4,
		    project_level_choices = $5, measure_defaults = $6, kitchen_layout = $7,
		    installation_checklist = $8, items = $9, notes = $10, updated_at = CURRENT_TIMESTAMP
		WHERE id = $11 AND organization_id = $12
		RETURNING updated_at;
	`
	err = s.db(ctx).QueryRow(ctx, query,
		t.Name, t.Currency, t.MarginFactor, t.LaborFixedCost,
		choicesToJSONB(t.ProjectLevelChoices),
		rawJSONB(t.MeasureDefaults),
		rawJSONB(t.KitchenLayout),
		rawJSONB(t.InstallationChecklist),
		itemsJSON,
		nullableString(t.Notes),
		id,
		OrgFromCtx(ctx),
	).Scan(&t.UpdatedAt)
	if err != nil {
		return fmt.Errorf("update project template: %w", err)
	}
	return nil
}

// DeleteProjectTemplate removes a template by id.
func (s *PostgresStore) DeleteProjectTemplate(ctx context.Context, id string) error {
	tag, err := s.db(ctx).Exec(ctx, `DELETE FROM project_templates WHERE id = $1 AND organization_id = $2`, id, OrgFromCtx(ctx))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("project template not found")
	}
	return nil
}

// scanner abstracts *pgx.Rows and *pgx.Row for the SELECT above.
type scanner interface {
	Scan(dest ...interface{}) error
}

func scanProjectTemplate(row scanner) (domain.ProjectTemplate, error) {
	var t domain.ProjectTemplate
	var projectLevelChoices []byte
	var measureDefaults []byte
	var kitchenLayout []byte
	var installationChecklist []byte
	var itemsRaw []byte
	var notes *string
	err := row.Scan(
		&t.ID, &t.Name, &t.Currency, &t.MarginFactor, &t.LaborFixedCost,
		&projectLevelChoices, &measureDefaults, &kitchenLayout,
		&installationChecklist, &itemsRaw, &notes,
		&t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		return t, err
	}
	if len(projectLevelChoices) > 0 && string(projectLevelChoices) != "null" {
		t.ProjectLevelChoices = parseStringMap(projectLevelChoices)
	}
	if len(measureDefaults) > 0 && string(measureDefaults) != "null" {
		t.MeasureDefaults = measureDefaults
	}
	if len(kitchenLayout) > 0 && string(kitchenLayout) != "null" {
		t.KitchenLayout = kitchenLayout
	}
	if len(installationChecklist) > 0 && string(installationChecklist) != "null" {
		t.InstallationChecklist = installationChecklist
	}
	if len(itemsRaw) > 0 && string(itemsRaw) != "null" {
		if err := json.Unmarshal(itemsRaw, &t.Items); err != nil {
			return t, fmt.Errorf("unmarshal template items: %w", err)
		}
	}
	if notes != nil {
		t.Notes = *notes
	}
	return t, nil
}

func itemsToJSONB(items []domain.ProjectItem) ([]byte, error) {
	if items == nil {
		items = []domain.ProjectItem{}
	}
	return json.Marshal(items)
}

// choicesToJSONB marshals a string map to JSONB; nil maps marshal to NULL via
// the helper below (we pass nil when empty so the column stays NULL).
func choicesToJSONB(m map[string]string) []byte {
	if len(m) == 0 {
		return nil
	}
	b, err := json.Marshal(m)
	if err != nil {
		return nil
	}
	return b
}

// rawJSONB returns the bytes unchanged if non-empty/non-null, else nil so the
// column stores NULL.
func rawJSONB(b []byte) []byte {
	if len(b) == 0 || string(b) == "null" {
		return nil
	}
	return b
}

func parseStringMap(raw []byte) map[string]string {
	var m map[string]string
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil
	}
	return m
}

func nullableString(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
