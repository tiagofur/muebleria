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

// #387 / DT-3: Design aggregate and immutable DesignRevision snapshots
// (ADR-0003, digital-thread §§7-10).

type CreateDesignCommand struct {
	ProjectID             string
	Name                  string
	SourceQuoteRevisionID string
	Status                domain.DesignStatus
	ActorUserID           string
	IP                    string
	RequestID             string
}

type PublishDesignRevisionItemCommand struct {
	FurnitureInstanceID    string
	FurnitureDefinitionID  string
	DefinitionVersion      *int
	Parameters             map[string]any
	MaterialChoices        map[string]string
	Transform              domain.Transform3D
	RoomID                 string
	TechnicalClientLocator *domain.TechnicalClientLocator
}

type PublishDesignRevisionCommand struct {
	DesignID         string
	BaseRevisionID   string
	ParentRevisionID string
	SourceType       domain.DesignRevisionSourceType
	Items            []PublishDesignRevisionItemCommand
	ActorUserID      string
	IP               string
	RequestID        string
}

const designColumns = `
	id, organization_id, project_id, name,
	COALESCE(source_quote_revision_id::text, ''),
	status, COALESCE(created_by::text, ''),
	created_at, updated_at`

func scanDesign(row pgx.Row) (*domain.Design, error) {
	var d domain.Design
	if err := row.Scan(
		&d.ID, &d.OrganizationID, &d.ProjectID, &d.Name,
		&d.SourceQuoteRevisionID, &d.Status, &d.CreatedBy,
		&d.CreatedAt, &d.UpdatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignNotFound
		}
		return nil, err
	}
	return &d, nil
}

func (s *PostgresStore) CreateDesign(ctx context.Context, cmd CreateDesignCommand) (*domain.Design, error) {
	name := strings.TrimSpace(cmd.Name)
	if name == "" || !isValidUUID(cmd.ProjectID) {
		return nil, domain.ErrInvalidDesignCommand
	}
	if cmd.Status == "" {
		cmd.Status = domain.DesignStatusActive
	} else if !domain.IsValidDesignStatus(cmd.Status) {
		return nil, domain.ErrInvalidDesignCommand
	}
	if cmd.SourceQuoteRevisionID != "" && !isValidUUID(cmd.SourceQuoteRevisionID) {
		return nil, domain.ErrInvalidDesignCommand
	}

	if transactionFromContext(ctx) == nil {
		var created *domain.Design
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			res, err := s.CreateDesign(txCtx, cmd)
			if err != nil {
				return err
			}
			created = res
			return nil
		})
		return created, err
	}

	// Verify project exists and is accessible under tenant scope.
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

	actorOrg := OrgFromCtx(ctx)
	if actorOrg != "" && actorOrg != projectOrgID {
		return nil, domain.ErrFurnitureInstanceProjectNotWritable
	}

	var sourceQuoteRev *string
	if cmd.SourceQuoteRevisionID != "" {
		sourceQuoteRev = &cmd.SourceQuoteRevisionID
	}
	var createdBy *string
	if isValidUUID(cmd.ActorUserID) {
		createdBy = &cmd.ActorUserID
	}

	row := s.db(ctx).QueryRow(ctx, `
		INSERT INTO designs (organization_id, project_id, name, source_quote_revision_id, status, created_by)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING `+designColumns,
		projectOrgID, cmd.ProjectID, name, sourceQuoteRev, cmd.Status, createdBy,
	)
	design, err := scanDesign(row)
	if err != nil {
		return nil, err
	}

	if err := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
		EventType:      "design_created",
		ActorUserID:    nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx)),
		OrganizationID: design.OrganizationID,
		IP:             cmd.IP,
		RequestID:      cmd.RequestID,
		Details: map[string]interface{}{
			"design_id":                 design.ID,
			"project_id":                design.ProjectID,
			"name":                      design.Name,
			"status":                    string(design.Status),
			"source_quote_revision_id": design.SourceQuoteRevisionID,
		},
	}); err != nil {
		return nil, fmt.Errorf("audit design_created: %w", err)
	}

	return design, nil
}

func (s *PostgresStore) GetDesignByID(ctx context.Context, designID string) (*domain.Design, error) {
	if !isValidUUID(designID) {
		return nil, domain.ErrDesignNotFound
	}
	row := s.db(ctx).QueryRow(ctx, `
		SELECT `+designColumns+`
		FROM designs
		WHERE id = $1
	`, designID)
	return scanDesign(row)
}

func (s *PostgresStore) ListDesignsByProject(ctx context.Context, projectID string) ([]domain.Design, error) {
	if !isValidUUID(projectID) {
		return nil, domain.ErrDesignNotFound
	}
	// Verify project access.
	var pOrg string
	if err := s.db(ctx).QueryRow(ctx, `SELECT organization_id FROM projects WHERE id = $1`, projectID).Scan(&pOrg); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignNotFound
		}
		return nil, err
	}

	rows, err := s.db(ctx).Query(ctx, `
		SELECT `+designColumns+`
		FROM designs
		WHERE project_id = $1
		ORDER BY created_at ASC
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var designs []domain.Design
	for rows.Next() {
		d, err := scanDesign(rows)
		if err != nil {
			return nil, err
		}
		designs = append(designs, *d)
	}
	return designs, rows.Err()
}

const designRevisionColumns = `
	id, organization_id, project_id, design_id,
	revision_number, COALESCE(parent_revision_id::text, ''),
	source_type, status, COALESCE(created_by::text, ''),
	created_at`

func scanDesignRevision(row pgx.Row) (*domain.DesignRevision, error) {
	var r domain.DesignRevision
	if err := row.Scan(
		&r.ID, &r.OrganizationID, &r.ProjectID, &r.DesignID,
		&r.RevisionNumber, &r.ParentRevisionID,
		&r.SourceType, &r.Status, &r.CreatedBy,
		&r.CreatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignRevisionNotFound
		}
		return nil, err
	}
	return &r, nil
}

const designRevisionItemColumns = `
	id, organization_id, project_id, design_revision_id,
	furniture_instance_id, COALESCE(furniture_definition_id::text, ''),
	definition_version, parameters, material_choices,
	transform, COALESCE(room_id, ''), technical_client_locator,
	created_at`

func scanDesignRevisionItem(row pgx.Row) (*domain.DesignRevisionItem, error) {
	var item domain.DesignRevisionItem
	var rawParams, rawMaterials, rawTransform []byte
	var rawLocator []byte
	if err := row.Scan(
		&item.ID, &item.OrganizationID, &item.ProjectID, &item.DesignRevisionID,
		&item.FurnitureInstanceID, &item.FurnitureDefinitionID,
		&item.DefinitionVersion, &rawParams, &rawMaterials,
		&rawTransform, &item.RoomID, &rawLocator,
		&item.CreatedAt,
	); err != nil {
		return nil, err
	}
	if len(rawParams) > 0 {
		_ = json.Unmarshal(rawParams, &item.Parameters)
	}
	if item.Parameters == nil {
		item.Parameters = make(map[string]any)
	}
	if len(rawMaterials) > 0 {
		_ = json.Unmarshal(rawMaterials, &item.MaterialChoices)
	}
	if item.MaterialChoices == nil {
		item.MaterialChoices = make(map[string]string)
	}
	if len(rawTransform) > 0 && string(rawTransform) != "{}" && string(rawTransform) != "null" {
		var t domain.Transform3D
		if err := json.Unmarshal(rawTransform, &t); err == nil {
			item.Transform = &t
		}
	}
	if len(rawLocator) > 0 && string(rawLocator) != "null" {
		var loc domain.TechnicalClientLocator
		if err := json.Unmarshal(rawLocator, &loc); err == nil && loc.Kind != "" {
			item.TechnicalClientLocator = &loc
		}
	}
	return &item, nil
}

func (s *PostgresStore) PublishDesignRevision(ctx context.Context, cmd PublishDesignRevisionCommand) (*domain.DesignRevision, error) {
	if !isValidUUID(cmd.DesignID) {
		return nil, domain.ErrDesignNotFound
	}
	if cmd.SourceType == "" {
		cmd.SourceType = domain.DesignRevisionSourceSystem
	} else if !domain.IsValidDesignRevisionSourceType(cmd.SourceType) {
		return nil, domain.ErrInvalidDesignCommand
	}
	if cmd.BaseRevisionID != "" && !isValidUUID(cmd.BaseRevisionID) {
		return nil, domain.ErrInvalidDesignCommand
	}
	if cmd.ParentRevisionID != "" && !isValidUUID(cmd.ParentRevisionID) {
		return nil, domain.ErrInvalidDesignCommand
	}

	if transactionFromContext(ctx) == nil {
		var published *domain.DesignRevision
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			res, err := s.PublishDesignRevision(txCtx, cmd)
			if err != nil {
				return err
			}
			published = res
			return nil
		})
		return published, err
	}

	// 1. Lock the design row FOR UPDATE to serialize publishing and revision numbering.
	var designOrgID, projectID, designStatus string
	err := s.db(ctx).QueryRow(ctx, `
		SELECT organization_id, project_id, status
		FROM designs
		WHERE id = $1
		FOR UPDATE
	`, cmd.DesignID).Scan(&designOrgID, &projectID, &designStatus)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignNotFound
		}
		return nil, err
	}
	if designStatus != string(domain.DesignStatusActive) {
		return nil, domain.ErrDesignNotActive
	}

	actorOrg := OrgFromCtx(ctx)
	if actorOrg != "" && actorOrg != designOrgID {
		return nil, domain.ErrFurnitureInstanceProjectNotWritable
	}

	// 2. Concurrency and revision numbering: fetch latest revision for the locked design.
	var latestRevID string
	var latestRevNum int
	err = s.db(ctx).QueryRow(ctx, `
		SELECT id, revision_number
		FROM design_revisions
		WHERE design_id = $1
		ORDER BY revision_number DESC
		LIMIT 1
	`, cmd.DesignID).Scan(&latestRevID, &latestRevNum)

	var nextRevisionNum int
	var effectiveParentID *string

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// No previous revision exists: this will be R1.
			if cmd.BaseRevisionID != "" {
				return nil, fmt.Errorf("%w: base revision specified (%s) but design has no previous revisions", domain.ErrDesignRevisionConflict, cmd.BaseRevisionID)
			}
			if cmd.ParentRevisionID != "" {
				return nil, domain.ErrInvalidParentRevision
			}
			nextRevisionNum = 1
			effectiveParentID = nil
		} else {
			return nil, err
		}
	} else {
		// Previous revision exists: check base revision for optimistic concurrency (I18).
		if cmd.BaseRevisionID != "" && cmd.BaseRevisionID != latestRevID {
			return nil, fmt.Errorf("%w: base revision %s is stale; latest is %s (R%d)", domain.ErrDesignRevisionConflict, cmd.BaseRevisionID, latestRevID, latestRevNum)
		}
		if cmd.ParentRevisionID != "" {
			// Verify parent revision belongs to this design.
			var parentDesignID string
			pErr := s.db(ctx).QueryRow(ctx, `
				SELECT design_id FROM design_revisions WHERE id = $1
			`, cmd.ParentRevisionID).Scan(&parentDesignID)
			if pErr != nil || parentDesignID != cmd.DesignID {
				return nil, domain.ErrInvalidParentRevision
			}
			parentID := cmd.ParentRevisionID
			effectiveParentID = &parentID
		} else {
			// Default parent to latest revision.
			effectiveParentID = &latestRevID
		}
		nextRevisionNum = latestRevNum + 1
	}

	// 3. Validate items.
	seenInstances := make(map[string]struct{}, len(cmd.Items))
	instanceIDs := make([]string, 0, len(cmd.Items))
	for _, item := range cmd.Items {
		if !isValidUUID(item.FurnitureInstanceID) {
			return nil, domain.ErrInvalidDesignCommand
		}
		if _, exists := seenInstances[item.FurnitureInstanceID]; exists {
			// Duplicate FI within one revision is rejected (I11).
			return nil, fmt.Errorf("%w: furniture instance %s appears more than once", domain.ErrDuplicateFurnitureInstanceInRevision, item.FurnitureInstanceID)
		}
		seenInstances[item.FurnitureInstanceID] = struct{}{}
		instanceIDs = append(instanceIDs, item.FurnitureInstanceID)
	}

	if len(instanceIDs) > 0 {
		// Validate that all instances belong to the SAME project and are not removed/cancelled.
		rows, err := s.db(ctx).Query(ctx, `
			SELECT id, project_id, lifecycle_status
			FROM furniture_instances
			WHERE id = ANY($1)
		`, instanceIDs)
		if err != nil {
			return nil, err
		}
		defer rows.Close()

		foundMap := make(map[string]struct {
			projectID string
			lifecycle string
		})
		for rows.Next() {
			var id, pID, lifecycle string
			if err := rows.Scan(&id, &pID, &lifecycle); err != nil {
				return nil, err
			}
			foundMap[id] = struct {
				projectID string
				lifecycle string
			}{projectID: pID, lifecycle: lifecycle}
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}

		for _, fiID := range instanceIDs {
			info, found := foundMap[fiID]
			if !found {
				return nil, fmt.Errorf("%w: instance %s not found", ErrFurnitureInstanceNotFound, fiID)
			}
			if info.projectID != projectID {
				// Same-project invariant (I10).
				return nil, fmt.Errorf("%w: instance %s belongs to project %s, not %s", domain.ErrCrossProjectFurnitureInstance, fiID, info.projectID, projectID)
			}
			if domain.FurnitureInstanceLifecycleTerminal(domain.FurnitureInstanceLifecycle(info.lifecycle)) {
				return nil, fmt.Errorf("%w: instance %s is %s", domain.ErrFurnitureInstanceLifecycleConflict, fiID, info.lifecycle)
			}
		}
	}

	// 4. Insert design_revision row.
	var createdBy *string
	if isValidUUID(cmd.ActorUserID) {
		createdBy = &cmd.ActorUserID
	}

	var rev domain.DesignRevision
	err = s.db(ctx).QueryRow(ctx, `
		INSERT INTO design_revisions (
			organization_id, project_id, design_id, revision_number,
			parent_revision_id, source_type, status, created_by
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING `+designRevisionColumns,
		designOrgID, projectID, cmd.DesignID, nextRevisionNum,
		effectiveParentID, cmd.SourceType, domain.DesignRevisionStatusPublished, createdBy,
	).Scan(
		&rev.ID, &rev.OrganizationID, &rev.ProjectID, &rev.DesignID,
		&rev.RevisionNumber, &rev.ParentRevisionID,
		&rev.SourceType, &rev.Status, &rev.CreatedBy,
		&rev.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert design revision: %w", err)
	}

	// 5. Insert design_revision_items rows.
	revItems := make([]domain.DesignRevisionItem, 0, len(cmd.Items))
	for _, itemCmd := range cmd.Items {
		var defID *string
		if isValidUUID(itemCmd.FurnitureDefinitionID) {
			defID = &itemCmd.FurnitureDefinitionID
		}
		paramsJSON, err := json.Marshal(itemCmd.Parameters)
		if err != nil {
			paramsJSON = []byte("{}")
		}
		materialsJSON, err := json.Marshal(itemCmd.MaterialChoices)
		if err != nil {
			materialsJSON = []byte("{}")
		}
		transformJSON, err := json.Marshal(itemCmd.Transform)
		if err != nil {
			transformJSON = []byte(`{"translationMm":[0,0,0],"rotationDeg":[0,0,0]}`)
		}
		var locatorJSON []byte
		if itemCmd.TechnicalClientLocator != nil && itemCmd.TechnicalClientLocator.Kind != "" {
			locatorJSON, _ = json.Marshal(itemCmd.TechnicalClientLocator)
		}

		var insertedItem domain.DesignRevisionItem
		var rawP, rawM, rawT, rawL []byte
		err = s.db(ctx).QueryRow(ctx, `
			INSERT INTO design_revision_items (
				organization_id, project_id, design_revision_id,
				furniture_instance_id, furniture_definition_id, definition_version,
				parameters, material_choices, transform, room_id, technical_client_locator
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			RETURNING `+designRevisionItemColumns,
			designOrgID, projectID, rev.ID,
			itemCmd.FurnitureInstanceID, defID, itemCmd.DefinitionVersion,
			paramsJSON, materialsJSON, transformJSON, itemCmd.RoomID, locatorJSON,
		).Scan(
			&insertedItem.ID, &insertedItem.OrganizationID, &insertedItem.ProjectID, &insertedItem.DesignRevisionID,
			&insertedItem.FurnitureInstanceID, &insertedItem.FurnitureDefinitionID,
			&insertedItem.DefinitionVersion, &rawP, &rawM, &rawT, &insertedItem.RoomID, &rawL,
			&insertedItem.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("insert design revision item: %w", err)
		}
		if len(rawP) > 0 {
			_ = json.Unmarshal(rawP, &insertedItem.Parameters)
		}
		if len(rawM) > 0 {
			_ = json.Unmarshal(rawM, &insertedItem.MaterialChoices)
		}
		if len(rawT) > 0 && string(rawT) != "{}" && string(rawT) != "null" {
			var t domain.Transform3D
			if err := json.Unmarshal(rawT, &t); err == nil {
				insertedItem.Transform = &t
			}
		}
		if len(rawL) > 0 && string(rawL) != "null" {
			var loc domain.TechnicalClientLocator
			if err := json.Unmarshal(rawL, &loc); err == nil && loc.Kind != "" {
				insertedItem.TechnicalClientLocator = &loc
			}
		}
		revItems = append(revItems, insertedItem)
	}
	rev.Items = revItems

	// 6. Security audit event for publication.
	if err := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
		EventType:      "design_revision_published",
		ActorUserID:    nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx)),
		OrganizationID: rev.OrganizationID,
		IP:             cmd.IP,
		RequestID:      cmd.RequestID,
		Details: map[string]interface{}{
			"design_revision_id": rev.ID,
			"design_id":          rev.DesignID,
			"project_id":         rev.ProjectID,
			"revision_number":    rev.RevisionNumber,
			"parent_revision_id": rev.ParentRevisionID,
			"source_type":        string(rev.SourceType),
			"item_count":         len(rev.Items),
		},
	}); err != nil {
		return nil, fmt.Errorf("audit design_revision_published: %w", err)
	}

	return &rev, nil
}

func (s *PostgresStore) GetDesignRevision(ctx context.Context, designID string, revisionID string) (*domain.DesignRevision, error) {
	if !isValidUUID(designID) || !isValidUUID(revisionID) {
		return nil, domain.ErrDesignRevisionNotFound
	}
	row := s.db(ctx).QueryRow(ctx, `
		SELECT `+designRevisionColumns+`
		FROM design_revisions
		WHERE id = $1 AND design_id = $2
	`, revisionID, designID)
	rev, err := scanDesignRevision(row)
	if err != nil {
		return nil, err
	}

	items, err := s.ListDesignRevisionItems(ctx, rev.ID)
	if err != nil {
		return nil, err
	}
	rev.Items = items
	return rev, nil
}

func (s *PostgresStore) ListDesignRevisions(ctx context.Context, designID string) ([]domain.DesignRevision, error) {
	if !isValidUUID(designID) {
		return nil, domain.ErrDesignNotFound
	}
	// Verify design exists and is accessible.
	var dOrg string
	if err := s.db(ctx).QueryRow(ctx, `SELECT organization_id FROM designs WHERE id = $1`, designID).Scan(&dOrg); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignNotFound
		}
		return nil, err
	}

	rows, err := s.db(ctx).Query(ctx, `
		SELECT `+designRevisionColumns+`
		FROM design_revisions
		WHERE design_id = $1
		ORDER BY revision_number ASC
	`, designID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var revisions []domain.DesignRevision
	for rows.Next() {
		r, err := scanDesignRevision(rows)
		if err != nil {
			return nil, err
		}
		revisions = append(revisions, *r)
	}
	return revisions, rows.Err()
}

func (s *PostgresStore) ListDesignRevisionItems(ctx context.Context, revisionID string) ([]domain.DesignRevisionItem, error) {
	if !isValidUUID(revisionID) {
		return nil, domain.ErrDesignRevisionNotFound
	}
	rows, err := s.db(ctx).Query(ctx, `
		SELECT `+designRevisionItemColumns+`
		FROM design_revision_items
		WHERE design_revision_id = $1
		ORDER BY created_at ASC
	`, revisionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []domain.DesignRevisionItem
	for rows.Next() {
		item, err := scanDesignRevisionItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, *item)
	}
	return items, rows.Err()
}
