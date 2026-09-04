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

// #393 / DT-9: QuoteRevision ↔ DesignRevision reconciliation by FurnitureInstance
// (ADR-0003, digital-thread §§15–16, 25, 26, 28, 30–31).

// CreateQuoteRevisionCommand holds parameters to record an immutable QuoteRevision snapshot.
type CreateQuoteRevisionCommand struct {
	ID             string
	OrganizationID string
	ProjectID      string
	BaseRevisionID string
	RevisionNumber int
	Status         string
	SourceType     string
	Notes          string
	CreatedBy      string
	Items          []CreateQuoteRevisionItemCommand
	// Requote provenance (#394 / DT-10): recorded verbatim when SourceType is
	// "requote" (and tolerated empty otherwise).
	SourceDesignRevisionID string
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
// It executes atomically within a transaction and acquires a row lock on the parent project
// to serialize revision numbering. Optimistic concurrency is mandatory and fail-closed
// (digital-thread §18): when previous revisions exist, BaseRevisionID must reference the
// exact latest revision; an omitted or stale base returns ErrQuoteRevisionConflict instead
// of creating a new revision.
func (s *PostgresStore) CreateQuoteRevision(ctx context.Context, cmd CreateQuoteRevisionCommand) (*domain.QuoteRevision, error) {
	if !isValidUUID(cmd.ProjectID) {
		return nil, domain.ErrInvalidRevisionID
	}
	if cmd.BaseRevisionID != "" && !isValidUUID(cmd.BaseRevisionID) {
		return nil, domain.ErrInvalidRevisionID
	}
	quoteRevID := strings.TrimSpace(cmd.ID)
	if quoteRevID != "" && !isValidUUID(quoteRevID) {
		return nil, domain.ErrInvalidRevisionID
	}

	tx, owned, err := s.beginOrUseTx(ctx)
	if err != nil {
		return nil, err
	}
	if owned {
		defer tx.Rollback(ctx)
	}
	txCtx := context.WithValue(ctx, transactionContextKey{}, tx)

	// 1. Lock the parent project row to serialize revision generation and check ownership.
	var projectOrgID, projectStatus string
	err = s.db(txCtx).QueryRow(txCtx, `
		SELECT organization_id, status
		FROM projects
		WHERE id = $1
		FOR UPDATE
	`, cmd.ProjectID).Scan(&projectOrgID, &projectStatus)
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

	// 2. Concurrency-safe revision numbering & optimistic concurrency check.
	var latestRevID string
	var latestRevNum int
	err = s.db(txCtx).QueryRow(txCtx, `
		SELECT id, revision_number
		FROM quote_revisions
		WHERE project_id = $1
		ORDER BY revision_number DESC
		LIMIT 1
	`, cmd.ProjectID).Scan(&latestRevID, &latestRevNum)

	var revNum int
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// No previous revision exists
			if cmd.BaseRevisionID != "" {
				return nil, fmt.Errorf("%w: base revision specified (%s) but project has no previous quote revisions", domain.ErrQuoteRevisionConflict, cmd.BaseRevisionID)
			}
			if cmd.RevisionNumber <= 0 {
				revNum = 1
			} else {
				revNum = cmd.RevisionNumber
			}
		} else {
			return nil, err
		}
	} else {
		// Previous revision exists: optimistic concurrency is mandatory (fail-closed,
		// digital-thread §18). The caller must base the new revision on the exact
		// latest revision; omitting or staleness is a conflict, never a silent overwrite.
		if cmd.BaseRevisionID == "" {
			return nil, fmt.Errorf("%w: base revision is required when the project already has quote revisions; latest is %s (Q%d)", domain.ErrQuoteRevisionConflict, latestRevID, latestRevNum)
		}
		if cmd.BaseRevisionID != latestRevID {
			return nil, fmt.Errorf("%w: base revision %s is stale; latest is %s (Q%d)", domain.ErrQuoteRevisionConflict, cmd.BaseRevisionID, latestRevID, latestRevNum)
		}
		if cmd.RevisionNumber <= 0 {
			revNum = latestRevNum + 1
		} else {
			if cmd.RevisionNumber <= latestRevNum {
				return nil, fmt.Errorf("%w: requested revision number %d conflicts with latest revision %d", domain.ErrQuoteRevisionConflict, cmd.RevisionNumber, latestRevNum)
			}
			revNum = cmd.RevisionNumber
		}
	}

	status := strings.TrimSpace(cmd.Status)
	if status == "" {
		status = "published"
	}
	sourceType := strings.TrimSpace(cmd.SourceType)
	if sourceType == "" {
		sourceType = "manual"
	}
	sourceDesignRevisionID := strings.TrimSpace(cmd.SourceDesignRevisionID)
	if sourceDesignRevisionID != "" && !isValidUUID(sourceDesignRevisionID) {
		return nil, domain.ErrInvalidRevisionID
	}
	if sourceType == "requote" {
		// A requote without exact provenance would break the commercial
		// traceability contract (#394 §36) — fail closed.
		if cmd.BaseRevisionID == "" || sourceDesignRevisionID == "" {
			return nil, fmt.Errorf("%w: requote revisions require baseQuoteRevisionId and sourceDesignRevisionId", domain.ErrInvalidRevisionSnapshot)
		}
	}

	var createdBy *string
	if isValidUUID(cmd.CreatedBy) {
		cb := cmd.CreatedBy
		createdBy = &cb
	}
	var baseRevisionID *string
	if cmd.BaseRevisionID != "" {
		b := cmd.BaseRevisionID
		baseRevisionID = &b
	}
	var sourceDesignRevID *string
	if sourceDesignRevisionID != "" {
		d := sourceDesignRevisionID
		sourceDesignRevID = &d
	}

	var rev domain.QuoteRevision
	var insertQuery string
	var args []any
	if quoteRevID != "" {
		insertQuery = `
			INSERT INTO quote_revisions (
				id, organization_id, project_id, revision_number,
				status, source_type, notes, created_by,
				base_quote_revision_id, source_design_revision_id
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			RETURNING id, organization_id, project_id, revision_number, status, source_type, COALESCE(notes, ''),
				COALESCE(base_quote_revision_id::text, ''), COALESCE(source_design_revision_id::text, '')
		`
		args = []any{quoteRevID, orgID, cmd.ProjectID, revNum, status, sourceType, cmd.Notes, createdBy, baseRevisionID, sourceDesignRevID}
	} else {
		insertQuery = `
			INSERT INTO quote_revisions (
				organization_id, project_id, revision_number,
				status, source_type, notes, created_by,
				base_quote_revision_id, source_design_revision_id
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			RETURNING id, organization_id, project_id, revision_number, status, source_type, COALESCE(notes, ''),
				COALESCE(base_quote_revision_id::text, ''), COALESCE(source_design_revision_id::text, '')
		`
		args = []any{orgID, cmd.ProjectID, revNum, status, sourceType, cmd.Notes, createdBy, baseRevisionID, sourceDesignRevID}
	}

	err = s.db(txCtx).QueryRow(txCtx, insertQuery, args...).Scan(
		&rev.ID,
		&rev.OrganizationID,
		&rev.ProjectID,
		&rev.RevisionNumber,
		&rev.Status,
		&rev.SourceType,
		&rev.Notes,
		&rev.BaseQuoteRevisionID,
		&rev.SourceDesignRevisionID,
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

		_, err = s.db(txCtx).Exec(txCtx, `
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

	if owned {
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
	}

	return &rev, nil
}

// UpdateQuoteRevisionStatusCommand holds parameters for a legitimate metadata/status transition of a QuoteRevision.
type UpdateQuoteRevisionStatusCommand struct {
	QuoteRevisionID string
	Status          string
}

// UpdateQuoteRevisionStatus transitions the status of a QuoteRevision.
// Historical snapshot fields (project, revision number, items, source_type, created_at)
// and notes of published/accepted/superseded revisions cannot be mutated.
func (s *PostgresStore) UpdateQuoteRevisionStatus(ctx context.Context, cmd UpdateQuoteRevisionStatusCommand) (*domain.QuoteRevision, error) {
	if !isValidUUID(cmd.QuoteRevisionID) {
		return nil, domain.ErrInvalidRevisionID
	}
	targetStatus := strings.TrimSpace(cmd.Status)
	switch targetStatus {
	case "draft", "published", "accepted", "superseded":
	default:
		return nil, fmt.Errorf("%w: invalid target status %s", domain.ErrInvalidRevisionSnapshot, targetStatus)
	}

	tx, owned, err := s.beginOrUseTx(ctx)
	if err != nil {
		return nil, err
	}
	if owned {
		defer tx.Rollback(ctx)
	}
	txCtx := context.WithValue(ctx, transactionContextKey{}, tx)

	var rev domain.QuoteRevision
	err = s.db(txCtx).QueryRow(txCtx, `
		SELECT id, organization_id, project_id, revision_number, status, source_type, COALESCE(notes, ''),
			COALESCE(base_quote_revision_id::text, ''), COALESCE(source_design_revision_id::text, '')
		FROM quote_revisions
		WHERE id = $1
		FOR UPDATE
	`, cmd.QuoteRevisionID).Scan(
		&rev.ID,
		&rev.OrganizationID,
		&rev.ProjectID,
		&rev.RevisionNumber,
		&rev.Status,
		&rev.SourceType,
		&rev.Notes,
		&rev.BaseQuoteRevisionID,
		&rev.SourceDesignRevisionID,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrQuoteRevisionNotFound
		}
		return nil, err
	}

	// Validate status transition rules server-side before execution.
	// Canonical commercial lifecycle (mirrors the protect_quote_revision_immutability
	// DB trigger): draft → published → accepted|superseded → superseded → terminal.
	// No other transition is allowed, including same-status no-ops.
	transitionErr := func(allowed string) error {
		return fmt.Errorf("%w: %s quote_revision can only transition to %s, not %s", domain.ErrQuoteRevisionConflict, rev.Status, allowed, targetStatus)
	}
	if rev.Status == targetStatus {
		return nil, fmt.Errorf("%w: quote_revision status %s cannot transition to itself", domain.ErrQuoteRevisionConflict, rev.Status)
	}
	switch rev.Status {
	case "draft":
		if targetStatus != "published" {
			return nil, transitionErr("published")
		}
	case "published":
		if targetStatus != "accepted" && targetStatus != "superseded" {
			return nil, transitionErr("accepted or superseded")
		}
	case "accepted":
		if targetStatus != "superseded" {
			return nil, transitionErr("superseded")
		}
	case "superseded":
		return nil, transitionErr("nothing (terminal)")
	default:
		return nil, fmt.Errorf("%w: unknown current status %s", domain.ErrInvalidRevisionSnapshot, rev.Status)
	}

	err = s.db(txCtx).QueryRow(txCtx, `
		UPDATE quote_revisions
		SET status = $2
		WHERE id = $1
		RETURNING id, organization_id, project_id, revision_number, status, source_type, COALESCE(notes, ''),
			COALESCE(base_quote_revision_id::text, ''), COALESCE(source_design_revision_id::text, '')
	`, cmd.QuoteRevisionID, targetStatus).Scan(
		&rev.ID,
		&rev.OrganizationID,
		&rev.ProjectID,
		&rev.RevisionNumber,
		&rev.Status,
		&rev.SourceType,
		&rev.Notes,
		&rev.BaseQuoteRevisionID,
		&rev.SourceDesignRevisionID,
	)
	if err != nil {
		return nil, err
	}

	if owned {
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
	}

	return &rev, nil
}

// reconciliationInputs carries the exact loaded revision snapshots plus the
// metadata the readers need. Loaded fail-closed: corrupt JSON snapshots are
// rejected instead of guessed.
type reconciliationInputs struct {
	ProjectID        string
	OrganizationID   string
	QuoteRevisionID  string
	DesignRevisionID string
	QuoteStatus      string
	DesignStatus     string
	Quote            domain.QuoteRevisionSnapshot
	Design           domain.DesignRevisionSnapshot
}

// loadReconciliationInputs loads and validates the exact QuoteRevision and
// DesignRevision snapshots for a project under tenant RLS. Both revisions
// must belong to projectID. Read-only.
func (s *PostgresStore) loadReconciliationInputs(ctx context.Context, projectID, quoteRevisionID, designRevisionID string) (*reconciliationInputs, error) {
	// 1. Verify project exists and is accessible under tenant RLS.
	var projectOrgID string
	err := s.db(ctx).QueryRow(ctx, `
		SELECT organization_id FROM projects WHERE id = $1
	`, projectID).Scan(&projectOrgID)
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

	return &reconciliationInputs{
		ProjectID:        projectID,
		OrganizationID:   projectOrgID,
		QuoteRevisionID:  quoteRevisionID,
		DesignRevisionID: designRevisionID,
		QuoteStatus:      qrStatus,
		DesignStatus:     drStatus,
		Quote: domain.QuoteRevisionSnapshot{
			ProjectID:       projectID,
			QuoteRevisionID: quoteRevisionID,
			Items:           commercialItems,
		},
		Design: domain.DesignRevisionSnapshot{
			ProjectID:        projectID,
			DesignRevisionID: designRevisionID,
			Items:            designItems,
		},
	}, nil
}

// ReconcileProject performs a pure deterministic comparison between an exact
// QuoteRevision and an exact DesignRevision for the specified project.
// Both sides must belong to projectID and to the caller's tenant scope.
// It is strictly READ-ONLY: neither quote nor design records are mutated.
func (s *PostgresStore) ReconcileProject(ctx context.Context, projectID, quoteRevisionID, designRevisionID string) (*domain.ReconciliationResult, error) {
	if !isValidUUID(projectID) || !isValidUUID(quoteRevisionID) || !isValidUUID(designRevisionID) {
		return nil, domain.ErrInvalidRevisionID
	}

	inputs, err := s.loadReconciliationInputs(ctx, projectID, quoteRevisionID, designRevisionID)
	if err != nil {
		return nil, err
	}

	// 6. Run pure domain reconciliation
	return domain.Reconcile(inputs.Quote, inputs.Design)
}
