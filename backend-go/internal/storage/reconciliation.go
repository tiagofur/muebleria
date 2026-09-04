package storage

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #393 / DT-9: QuoteRevision ↔ DesignRevision reconciliation by FurnitureInstance
// (ADR-0003, digital-thread §§15–16, 25, 26, 28, 30–31).

// CreateQuoteRevisionCommand holds parameters to record an immutable QuoteRevision snapshot.
type CreateQuoteRevisionCommand struct {
	ID             string
	OrganizationID string
	ProjectID      string
	RevisionNumber int
	Status         string
	SourceType     string
	Notes          string
	CreatedBy      string
	Items          []CreateQuoteRevisionItemCommand
}

// CreateQuoteRevisionItemCommand holds parameters for one physical furniture unit snapshot.
type CreateQuoteRevisionItemCommand struct {
	FurnitureInstanceID   string
	FurnitureDefinitionID string
	DefinitionVersion     *int
	Parameters            map[string]any
	MaterialChoices       map[string]string
	LifecycleStatus       string
}

// CreateQuoteRevision persists an immutable historical commercial revision snapshot and its items.
func (s *PostgresStore) CreateQuoteRevision(ctx context.Context, cmd CreateQuoteRevisionCommand) (*domain.QuoteRevision, error) {
	if !isValidUUID(cmd.ProjectID) {
		return nil, domain.ErrInvalidRevisionID
	}

	var projectOrgID string
	err := s.db(ctx).QueryRow(ctx, `
		SELECT organization_id FROM projects WHERE id = $1
	`, cmd.ProjectID).Scan(&projectOrgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignNotFound
		}
		return nil, err
	}

	orgID := cmd.OrganizationID
	if orgID == "" {
		orgID = projectOrgID
	}

	status := strings.TrimSpace(cmd.Status)
	if status == "" {
		status = "published"
	}
	sourceType := strings.TrimSpace(cmd.SourceType)
	if sourceType == "" {
		sourceType = "manual"
	}

	revNum := cmd.RevisionNumber
	if revNum <= 0 {
		err = s.db(ctx).QueryRow(ctx, `
			SELECT COALESCE(MAX(revision_number), 0) + 1
			FROM quote_revisions
			WHERE project_id = $1
		`, cmd.ProjectID).Scan(&revNum)
		if err != nil {
			return nil, err
		}
	}

	quoteRevID := strings.TrimSpace(cmd.ID)
	if quoteRevID != "" && !isValidUUID(quoteRevID) {
		return nil, domain.ErrInvalidRevisionID
	}

	var createdBy *string
	if isValidUUID(cmd.CreatedBy) {
		cb := cmd.CreatedBy
		createdBy = &cb
	}

	var rev domain.QuoteRevision
	var insertQuery string
	var args []any
	if quoteRevID != "" {
		insertQuery = `
			INSERT INTO quote_revisions (
				id, organization_id, project_id, revision_number,
				status, source_type, notes, created_by
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			RETURNING id, organization_id, project_id, revision_number, status, source_type, COALESCE(notes, '')
		`
		args = []any{quoteRevID, orgID, cmd.ProjectID, revNum, status, sourceType, cmd.Notes, createdBy}
	} else {
		insertQuery = `
			INSERT INTO quote_revisions (
				organization_id, project_id, revision_number,
				status, source_type, notes, created_by
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING id, organization_id, project_id, revision_number, status, source_type, COALESCE(notes, '')
		`
		args = []any{orgID, cmd.ProjectID, revNum, status, sourceType, cmd.Notes, createdBy}
	}

	err = s.db(ctx).QueryRow(ctx, insertQuery, args...).Scan(
		&rev.ID,
		&rev.OrganizationID,
		&rev.ProjectID,
		&rev.RevisionNumber,
		&rev.Status,
		&rev.SourceType,
		&rev.Notes,
	)
	if err != nil {
		return nil, err
	}

	for _, item := range cmd.Items {
		if !isValidUUID(item.FurnitureInstanceID) {
			return nil, domain.ErrInvalidRevisionID
		}
		var defID *string
		if isValidUUID(item.FurnitureDefinitionID) {
			d := item.FurnitureDefinitionID
			defID = &d
		}
		paramsJSON := []byte("{}")
		if item.Parameters != nil {
			p, err := json.Marshal(item.Parameters)
			if err != nil {
				return nil, err
			}
			paramsJSON = p
		}
		matJSON := []byte("{}")
		if item.MaterialChoices != nil {
			m, err := json.Marshal(item.MaterialChoices)
			if err != nil {
				return nil, err
			}
			matJSON = m
		}
		lifecycle := strings.TrimSpace(item.LifecycleStatus)
		if lifecycle == "" {
			lifecycle = "active"
		}

		_, err = s.db(ctx).Exec(ctx, `
			INSERT INTO quote_revision_items (
				organization_id, project_id, quote_revision_id,
				furniture_instance_id, furniture_definition_id,
				definition_version, parameters, material_choices, lifecycle_status
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		`, orgID, cmd.ProjectID, rev.ID, item.FurnitureInstanceID, defID, item.DefinitionVersion, paramsJSON, matJSON, lifecycle)
		if err != nil {
			return nil, err
		}
	}

	return &rev, nil
}

// ReconcileProject performs a pure deterministic comparison between an exact
// QuoteRevision and an exact DesignRevision for the specified project.
// Both sides must belong to projectID and to the caller's tenant scope.
// It is strictly READ-ONLY: neither quote nor design records are mutated.
func (s *PostgresStore) ReconcileProject(ctx context.Context, projectID, quoteRevisionID, designRevisionID string) (*domain.ReconciliationResult, error) {
	if !isValidUUID(projectID) || !isValidUUID(quoteRevisionID) || !isValidUUID(designRevisionID) {
		return nil, domain.ErrInvalidRevisionID
	}

	// 1. Verify project exists and is accessible under tenant RLS.
	var projectOrgID, projectStatus string
	err := s.db(ctx).QueryRow(ctx, `
		SELECT organization_id, status FROM projects WHERE id = $1
	`, projectID).Scan(&projectOrgID, &projectStatus)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignNotFound
		}
		return nil, err
	}

	// 2. Load DesignRevision and verify same-project invariant.
	var drProjectID, drStatus string
	err = s.db(ctx).QueryRow(ctx, `
		SELECT project_id, status FROM design_revisions WHERE id = $1
	`, designRevisionID).Scan(&drProjectID, &drStatus)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignRevisionNotFound
		}
		return nil, err
	}
	if drProjectID != projectID {
		return nil, domain.ErrCrossProjectReconciliation
	}

	// 3. Load QuoteRevision and verify same-project invariant.
	var qrProjectID, qrStatus string
	err = s.db(ctx).QueryRow(ctx, `
		SELECT project_id, status FROM quote_revisions WHERE id = $1
	`, quoteRevisionID).Scan(&qrProjectID, &qrStatus)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrQuoteRevisionNotFound
		}
		return nil, err
	}
	if qrProjectID != projectID {
		return nil, domain.ErrCrossProjectReconciliation
	}

	// 4. Load Commercial Items Snapshot from quote_revision_items
	// Historical commercial snapshot is immutable and scoped strictly to this QuoteRevision.
	commercialRows, err := s.db(ctx).Query(ctx, `
		SELECT
			furniture_instance_id,
			COALESCE(furniture_definition_id::text, ''),
			definition_version,
			parameters,
			material_choices,
			lifecycle_status
		FROM quote_revision_items
		WHERE quote_revision_id = $1
		ORDER BY furniture_instance_id
	`, quoteRevisionID)
	if err != nil {
		return nil, err
	}
	defer commercialRows.Close()

	commercialItems := []domain.CommercialItemSnapshot{}
	for commercialRows.Next() {
		var fiID, defID, lifecycle string
		var defVersion *int
		var paramsJSON, matJSON []byte
		if err := commercialRows.Scan(&fiID, &defID, &defVersion, &paramsJSON, &matJSON, &lifecycle); err != nil {
			return nil, err
		}

		params := make(map[string]any)
		if len(paramsJSON) > 0 && string(paramsJSON) != "null" {
			if err := json.Unmarshal(paramsJSON, &params); err != nil {
				return nil, domain.ErrInvalidRevisionSnapshot
			}
		}

		matChoices := make(map[string]string)
		if len(matJSON) > 0 && string(matJSON) != "null" {
			if err := json.Unmarshal(matJSON, &matChoices); err != nil {
				return nil, domain.ErrInvalidRevisionSnapshot
			}
		}

		commercialItems = append(commercialItems, domain.CommercialItemSnapshot{
			FurnitureInstanceID:   fiID,
			FurnitureDefinitionID: defID,
			DefinitionVersion:     defVersion,
			Parameters:            params,
			MaterialChoices:       matChoices,
			LifecycleStatus:       lifecycle,
		})
	}
	if err := commercialRows.Err(); err != nil {
		return nil, err
	}

	// 5. Load DesignRevision items
	designItems := []domain.DesignRevisionItem{}
	dRows, err := s.db(ctx).Query(ctx, `
		SELECT
			id,
			project_id,
			design_revision_id,
			furniture_instance_id,
			COALESCE(furniture_definition_id::text, ''),
			definition_version,
			parameters,
			material_choices,
			transform,
			COALESCE(room_id, '')
		FROM design_revision_items
		WHERE design_revision_id = $1
		ORDER BY furniture_instance_id
	`, designRevisionID)
	if err != nil {
		return nil, err
	}
	defer dRows.Close()

	for dRows.Next() {
		var item domain.DesignRevisionItem
		var paramsJSON, matJSON, transformJSON []byte
		var defVersion *int
		if err := dRows.Scan(
			&item.ID,
			&item.ProjectID,
			&item.DesignRevisionID,
			&item.FurnitureInstanceID,
			&item.FurnitureDefinitionID,
			&defVersion,
			&paramsJSON,
			&matJSON,
			&transformJSON,
			&item.RoomID,
		); err != nil {
			return nil, err
		}
		item.DefinitionVersion = defVersion
		item.Parameters = make(map[string]any)
		if len(paramsJSON) > 0 && string(paramsJSON) != "null" {
			if err := json.Unmarshal(paramsJSON, &item.Parameters); err != nil {
				return nil, domain.ErrInvalidRevisionSnapshot
			}
		}
		item.MaterialChoices = make(map[string]string)
		if len(matJSON) > 0 && string(matJSON) != "null" {
			if err := json.Unmarshal(matJSON, &item.MaterialChoices); err != nil {
				return nil, domain.ErrInvalidRevisionSnapshot
			}
		}
		if len(transformJSON) > 0 && string(transformJSON) != "null" {
			var tf domain.Transform3D
			if err := json.Unmarshal(transformJSON, &tf); err != nil {
				return nil, domain.ErrInvalidRevisionSnapshot
			}
			item.Transform = &tf
		}
		designItems = append(designItems, item)
	}
	if err := dRows.Err(); err != nil {
		return nil, err
	}

	// 6. Run pure domain reconciliation
	quoteSnapshot := domain.QuoteRevisionSnapshot{
		ProjectID:       projectID,
		QuoteRevisionID: quoteRevisionID,
		Items:           commercialItems,
	}
	designSnapshot := domain.DesignRevisionSnapshot{
		ProjectID:        projectID,
		DesignRevisionID: designRevisionID,
		Items:            designItems,
	}

	return domain.Reconcile(quoteSnapshot, designSnapshot)
}
