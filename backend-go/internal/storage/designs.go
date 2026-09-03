package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

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
	DesignID       string
	BaseRevisionID string
	SourceType     domain.DesignRevisionSourceType
	ActorUserID    string
	IP             string
	RequestID      string
}

type UpdateDesignWorkingCopyItemCommand struct {
	FurnitureInstanceID    string
	FurnitureDefinitionID  string
	DefinitionVersion      *int
	Parameters             map[string]any
	MaterialChoices        map[string]string
	Transform              domain.Transform3D
	RoomID                 string
	TechnicalClientLocator *domain.TechnicalClientLocator
}

type UpdateDesignWorkingCopyCommand struct {
	DesignID       string
	BaseRevisionID *string
	SourceType     domain.DesignRevisionSourceType
	Items          []UpdateDesignWorkingCopyItemCommand
	ActorUserID    string
}

type ResetDesignWorkingCopyCommand struct {
	DesignID    string
	RevisionID  string
	ActorUserID string
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

	// Initialize persistent working copy draft for the design (ADR-0003, digital-thread §8).
	_, err = s.db(ctx).Exec(ctx, `
		INSERT INTO design_working_copies (design_id, organization_id, project_id, base_revision_id, source_type, updated_at, updated_by)
		VALUES ($1, $2, $3, NULL, 'manual', NOW(), $4)
		ON CONFLICT (design_id) DO NOTHING
	`, design.ID, design.OrganizationID, design.ProjectID, nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx)))
	if err != nil {
		return nil, fmt.Errorf("initialize design working copy: %w", err)
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
		if err := json.Unmarshal(rawParams, &item.Parameters); err != nil {
			return nil, fmt.Errorf("%w: read back parameters: %v", domain.ErrSerializationFailed, err)
		}
	}
	if item.Parameters == nil {
		item.Parameters = make(map[string]any)
	}
	if len(rawMaterials) > 0 {
		if err := json.Unmarshal(rawMaterials, &item.MaterialChoices); err != nil {
			return nil, fmt.Errorf("%w: read back material choices: %v", domain.ErrSerializationFailed, err)
		}
	}
	if item.MaterialChoices == nil {
		item.MaterialChoices = make(map[string]string)
	}
	if len(rawTransform) > 0 && string(rawTransform) != "{}" && string(rawTransform) != "null" {
		var t domain.Transform3D
		if err := json.Unmarshal(rawTransform, &t); err != nil {
			return nil, fmt.Errorf("%w: read back transform: %v", domain.ErrSerializationFailed, err)
		}
		item.Transform = &t
	}
	if len(rawLocator) > 0 && string(rawLocator) != "null" {
		var loc domain.TechnicalClientLocator
		if err := json.Unmarshal(rawLocator, &loc); err != nil {
			return nil, fmt.Errorf("%w: read back locator: %v", domain.ErrSerializationFailed, err)
		}
		if loc.Kind != "" {
			item.TechnicalClientLocator = &loc
		}
	}
	return &item, nil
}

const designWorkingItemColumns = `
	id, organization_id, project_id, design_id,
	furniture_instance_id, COALESCE(furniture_definition_id::text, ''),
	definition_version, parameters, material_choices,
	transform, COALESCE(room_id, ''), technical_client_locator,
	created_at, updated_at`

func scanDesignWorkingItem(row pgx.Row) (*domain.DesignWorkingItem, error) {
	var item domain.DesignWorkingItem
	var rawParams, rawMaterials, rawTransform []byte
	var rawLocator []byte
	if err := row.Scan(
		&item.ID, &item.OrganizationID, &item.ProjectID, &item.DesignID,
		&item.FurnitureInstanceID, &item.FurnitureDefinitionID,
		&item.DefinitionVersion, &rawParams, &rawMaterials,
		&rawTransform, &item.RoomID, &rawLocator,
		&item.CreatedAt, &item.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if len(rawParams) > 0 {
		if err := json.Unmarshal(rawParams, &item.Parameters); err != nil {
			return nil, fmt.Errorf("%w: read back parameters: %v", domain.ErrSerializationFailed, err)
		}
	}
	if item.Parameters == nil {
		item.Parameters = make(map[string]any)
	}
	if len(rawMaterials) > 0 {
		if err := json.Unmarshal(rawMaterials, &item.MaterialChoices); err != nil {
			return nil, fmt.Errorf("%w: read back material choices: %v", domain.ErrSerializationFailed, err)
		}
	}
	if item.MaterialChoices == nil {
		item.MaterialChoices = make(map[string]string)
	}
	if len(rawTransform) > 0 && string(rawTransform) != "{}" && string(rawTransform) != "null" {
		var t domain.Transform3D
		if err := json.Unmarshal(rawTransform, &t); err != nil {
			return nil, fmt.Errorf("%w: read back transform: %v", domain.ErrSerializationFailed, err)
		}
		item.Transform = &t
	}
	if len(rawLocator) > 0 && string(rawLocator) != "null" {
		var loc domain.TechnicalClientLocator
		if err := json.Unmarshal(rawLocator, &loc); err != nil {
			return nil, fmt.Errorf("%w: read back locator: %v", domain.ErrSerializationFailed, err)
		}
		if loc.Kind != "" {
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

	// 2. Lock working copy row FOR UPDATE: working copy is the sole mutable authoring authority.
	var wcBaseRevID *string
	var wcSourceType string
	err = s.db(ctx).QueryRow(ctx, `
		SELECT base_revision_id::text, source_type
		FROM design_working_copies
		WHERE design_id = $1
		FOR UPDATE
	`, cmd.DesignID).Scan(&wcBaseRevID, &wcSourceType)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			wcBaseRevID = nil
			wcSourceType = "manual"
		} else {
			return nil, err
		}
	}

	// 3. Concurrency and revision numbering: fetch latest revision for the locked design.
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
			// Semántica: workingCopy.baseRevisionId == null -> publish R1 allowed.
			if wcBaseRevID != nil && *wcBaseRevID != "" {
				return nil, fmt.Errorf("%w: working copy base revision is %s but design has no published revisions", domain.ErrDesignRevisionConflict, *wcBaseRevID)
			}
			if cmd.BaseRevisionID != "" {
				return nil, fmt.Errorf("%w: base revision specified (%s) but design has no previous revisions", domain.ErrDesignRevisionConflict, cmd.BaseRevisionID)
			}
			nextRevisionNum = 1
			effectiveParentID = nil
		} else {
			return nil, err
		}
	} else {
		// Previous revision exists: fail-closed optimistic concurrency.
		// Authority is design_working_copies.base_revision_id:
		// latest = R7: workingCopy.baseRevisionId MUST equal R7.
		if wcBaseRevID == nil || *wcBaseRevID == "" {
			return nil, fmt.Errorf("%w: working copy base revision is missing/null when revisions already exist; latest is %s (R%d)", domain.ErrDesignRevisionConflict, latestRevID, latestRevNum)
		}
		if *wcBaseRevID != latestRevID {
			return nil, fmt.Errorf("%w: working copy base revision %s is stale; latest is %s (R%d)", domain.ErrDesignRevisionConflict, *wcBaseRevID, latestRevID, latestRevNum)
		}
		// Base revision ID is required for optimistic concurrency when revisions exist.
		if cmd.BaseRevisionID == "" {
			return nil, fmt.Errorf("%w: base revision is required when revisions already exist; latest is %s (R%d)", domain.ErrDesignRevisionConflict, latestRevID, latestRevNum)
		}
		if cmd.BaseRevisionID != latestRevID {
			return nil, fmt.Errorf("%w: client base revision %s is stale; latest is %s (R%d)", domain.ErrDesignRevisionConflict, cmd.BaseRevisionID, latestRevID, latestRevNum)
		}
		// Linear parent chain: parent revision is derived from latest/base revision.
		effectiveParentID = &latestRevID
		nextRevisionNum = latestRevNum + 1
	}

	// 4. Resolve items to publish: ALWAYS from persistent working copy (single source of authoring truth).
	wRows, err := s.db(ctx).Query(ctx, `
		SELECT furniture_instance_id, COALESCE(furniture_definition_id::text, ''),
		       definition_version, parameters, material_choices,
		       transform, COALESCE(room_id, ''), technical_client_locator
		FROM design_working_items
		WHERE design_id = $1
		ORDER BY created_at ASC
	`, cmd.DesignID)
	if err != nil {
		return nil, fmt.Errorf("load working items for publish: %w", err)
	}
	defer wRows.Close()

	var itemsToPublish []PublishDesignRevisionItemCommand
	for wRows.Next() {
		var itm PublishDesignRevisionItemCommand
		var rawP, rawM, rawT, rawL []byte
		var defIDStr string
		if err := wRows.Scan(
			&itm.FurnitureInstanceID, &defIDStr,
			&itm.DefinitionVersion, &rawP, &rawM, &rawT,
			&itm.RoomID, &rawL,
		); err != nil {
			return nil, fmt.Errorf("scan working item for publish: %w", err)
		}
		itm.FurnitureDefinitionID = defIDStr
		if len(rawP) > 0 {
			if err := json.Unmarshal(rawP, &itm.Parameters); err != nil {
				return nil, fmt.Errorf("%w: unmarshal working item parameters: %v", domain.ErrSerializationFailed, err)
			}
		}
		if len(rawM) > 0 {
			if err := json.Unmarshal(rawM, &itm.MaterialChoices); err != nil {
				return nil, fmt.Errorf("%w: unmarshal working item material_choices: %v", domain.ErrSerializationFailed, err)
			}
		}
		if len(rawT) > 0 && string(rawT) != "{}" && string(rawT) != "null" {
			if err := json.Unmarshal(rawT, &itm.Transform); err != nil {
				return nil, fmt.Errorf("%w: unmarshal working item transform: %v", domain.ErrSerializationFailed, err)
			}
		}
		if len(rawL) > 0 && string(rawL) != "null" {
			var loc domain.TechnicalClientLocator
			if err := json.Unmarshal(rawL, &loc); err != nil {
				return nil, fmt.Errorf("%w: unmarshal working item locator: %v", domain.ErrSerializationFailed, err)
			}
			if loc.Kind != "" {
				itm.TechnicalClientLocator = &loc
			}
		}
		itemsToPublish = append(itemsToPublish, itm)
	}
	if err := wRows.Err(); err != nil {
		return nil, err
	}

	// 5. Validate items.
	seenInstances := make(map[string]struct{}, len(itemsToPublish))
	instanceIDs := make([]string, 0, len(itemsToPublish))
	for _, item := range itemsToPublish {
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

	// 5. Insert design_revision row.
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

	// 6. Insert design_revision_items rows with strict serialization checking.
	revItems := make([]domain.DesignRevisionItem, 0, len(itemsToPublish))
	for _, itemCmd := range itemsToPublish {
		var defID *string
		if isValidUUID(itemCmd.FurnitureDefinitionID) {
			defID = &itemCmd.FurnitureDefinitionID
		}
		var paramsJSON []byte = []byte("{}")
		if itemCmd.Parameters != nil {
			p, err := json.Marshal(itemCmd.Parameters)
			if err != nil {
				return nil, fmt.Errorf("%w: parameters serialization error: %v", domain.ErrSerializationFailed, err)
			}
			paramsJSON = p
		}
		var materialsJSON []byte = []byte("{}")
		if itemCmd.MaterialChoices != nil {
			m, err := json.Marshal(itemCmd.MaterialChoices)
			if err != nil {
				return nil, fmt.Errorf("%w: material_choices serialization error: %v", domain.ErrSerializationFailed, err)
			}
			materialsJSON = m
		}
		transformJSON, err := json.Marshal(itemCmd.Transform)
		if err != nil {
			return nil, fmt.Errorf("%w: transform serialization error: %v", domain.ErrSerializationFailed, err)
		}
		var locatorJSON []byte
		if itemCmd.TechnicalClientLocator != nil && itemCmd.TechnicalClientLocator.Kind != "" {
			l, err := json.Marshal(itemCmd.TechnicalClientLocator)
			if err != nil {
				return nil, fmt.Errorf("%w: technical_client_locator serialization error: %v", domain.ErrSerializationFailed, err)
			}
			locatorJSON = l
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
			if err := json.Unmarshal(rawP, &insertedItem.Parameters); err != nil {
				return nil, fmt.Errorf("%w: unmarshal inserted parameters: %v", domain.ErrSerializationFailed, err)
			}
		}
		if len(rawM) > 0 {
			if err := json.Unmarshal(rawM, &insertedItem.MaterialChoices); err != nil {
				return nil, fmt.Errorf("%w: unmarshal inserted material_choices: %v", domain.ErrSerializationFailed, err)
			}
		}
		if len(rawT) > 0 && string(rawT) != "{}" && string(rawT) != "null" {
			var t domain.Transform3D
			if err := json.Unmarshal(rawT, &t); err != nil {
				return nil, fmt.Errorf("%w: unmarshal inserted transform: %v", domain.ErrSerializationFailed, err)
			}
			insertedItem.Transform = &t
		}
		if len(rawL) > 0 && string(rawL) != "null" {
			var loc domain.TechnicalClientLocator
			if err := json.Unmarshal(rawL, &loc); err != nil {
				return nil, fmt.Errorf("%w: unmarshal inserted locator: %v", domain.ErrSerializationFailed, err)
			}
			if loc.Kind != "" {
				insertedItem.TechnicalClientLocator = &loc
			}
		}
		revItems = append(revItems, insertedItem)
	}
	rev.Items = revItems

	// 7. Advance persistent working copy base_revision_id to the newly published revision (digital-thread §8).
	actor := nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx))
	_, err = s.db(ctx).Exec(ctx, `
		INSERT INTO design_working_copies (design_id, organization_id, project_id, base_revision_id, source_type, updated_at, updated_by)
		VALUES ($1, $2, $3, $4, $5, NOW(), $6)
		ON CONFLICT (design_id) DO UPDATE SET
			base_revision_id = EXCLUDED.base_revision_id,
			source_type = EXCLUDED.source_type,
			updated_at = NOW(),
			updated_by = EXCLUDED.updated_by
	`, cmd.DesignID, designOrgID, projectID, rev.ID, rev.SourceType, actor)
	if err != nil {
		return nil, fmt.Errorf("advance working copy base revision: %w", err)
	}

	// 8. Security audit event for publication.
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

func (s *PostgresStore) GetDesignWorkingCopy(ctx context.Context, designID string) (*domain.DesignWorkingCopy, error) {
	if !isValidUUID(designID) {
		return nil, domain.ErrDesignNotFound
	}

	var wc domain.DesignWorkingCopy
	var baseRevID *string
	row := s.db(ctx).QueryRow(ctx, `
		SELECT design_id, organization_id, project_id, base_revision_id::text, source_type, updated_at, updated_by
		FROM design_working_copies
		WHERE design_id = $1
	`, designID)
	err := row.Scan(&wc.DesignID, &wc.OrganizationID, &wc.ProjectID, &baseRevID, &wc.SourceType, &wc.UpdatedAt, &wc.UpdatedBy)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Check if design exists
			var orgID, projID string
			dErr := s.db(ctx).QueryRow(ctx, `SELECT organization_id, project_id FROM designs WHERE id = $1`, designID).Scan(&orgID, &projID)
			if dErr != nil {
				if errors.Is(dErr, pgx.ErrNoRows) {
					return nil, domain.ErrDesignNotFound
				}
				return nil, dErr
			}
			wc = domain.DesignWorkingCopy{
				DesignID:       designID,
				OrganizationID: orgID,
				ProjectID:      projID,
				BaseRevisionID: nil,
				SourceType:     domain.DesignRevisionSourceManual,
				Items:          []domain.DesignWorkingItem{},
			}
		} else {
			return nil, err
		}
	} else {
		wc.BaseRevisionID = baseRevID
	}

	rows, err := s.db(ctx).Query(ctx, `
		SELECT `+designWorkingItemColumns+`
		FROM design_working_items
		WHERE design_id = $1
		ORDER BY created_at ASC
	`, designID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []domain.DesignWorkingItem
	for rows.Next() {
		item, err := scanDesignWorkingItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, *item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	wc.Items = items
	return &wc, nil
}

func (s *PostgresStore) UpdateDesignWorkingCopy(ctx context.Context, cmd UpdateDesignWorkingCopyCommand) (*domain.DesignWorkingCopy, error) {
	if !isValidUUID(cmd.DesignID) {
		return nil, domain.ErrDesignNotFound
	}
	if cmd.SourceType != "" && !domain.IsValidDesignRevisionSourceType(cmd.SourceType) {
		return nil, domain.ErrInvalidDesignCommand
	}
	if cmd.BaseRevisionID != nil && *cmd.BaseRevisionID != "" && !isValidUUID(*cmd.BaseRevisionID) {
		return nil, domain.ErrInvalidDesignCommand
	}

	if transactionFromContext(ctx) == nil {
		var res *domain.DesignWorkingCopy
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			r, err := s.UpdateDesignWorkingCopy(txCtx, cmd)
			if err != nil {
				return err
			}
			res = r
			return nil
		})
		return res, err
	}

	// 1. Lock the design row FOR UPDATE
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

	// 2. Validate base_revision_id if provided
	if cmd.BaseRevisionID != nil && *cmd.BaseRevisionID != "" {
		var revDesignID string
		err := s.db(ctx).QueryRow(ctx, `
			SELECT design_id FROM design_revisions WHERE id = $1
		`, *cmd.BaseRevisionID).Scan(&revDesignID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, domain.ErrDesignRevisionNotFound
			}
			return nil, err
		}
		if revDesignID != cmd.DesignID {
			return nil, domain.ErrDesignRevisionNotFound
		}
	}

	// 3. Validate items
	seenFI := make(map[string]bool)
	for _, item := range cmd.Items {
		if !isValidUUID(item.FurnitureInstanceID) {
			return nil, fmt.Errorf("%w: invalid furniture_instance_id: %s", domain.ErrInvalidDesignCommand, item.FurnitureInstanceID)
		}
		if seenFI[item.FurnitureInstanceID] {
			return nil, domain.ErrDuplicateFurnitureInstanceInRevision
		}
		seenFI[item.FurnitureInstanceID] = true

		var fiProjID, fiStatus string
		err := s.db(ctx).QueryRow(ctx, `
			SELECT project_id, lifecycle_status
			FROM furniture_instances
			WHERE id = $1
		`, item.FurnitureInstanceID).Scan(&fiProjID, &fiStatus)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, fmt.Errorf("%w: furniture instance %s", ErrFurnitureInstanceNotFound, item.FurnitureInstanceID)
			}
			return nil, err
		}
		if fiProjID != projectID {
			return nil, domain.ErrCrossProjectFurnitureInstance
		}
		if fiStatus != string(domain.FurnitureInstanceLifecycleActive) {
			return nil, fmt.Errorf("%w: furniture instance %s has terminal status %s", domain.ErrFurnitureInstanceLifecycleConflict, item.FurnitureInstanceID, fiStatus)
		}
	}

	sourceType := cmd.SourceType
	if sourceType == "" {
		sourceType = domain.DesignRevisionSourceManual
	}

	// 4. Delete existing working items
	_, err = s.db(ctx).Exec(ctx, `DELETE FROM design_working_items WHERE design_id = $1`, cmd.DesignID)
	if err != nil {
		return nil, fmt.Errorf("delete existing working items: %w", err)
	}

	// 5. Insert new working items
	for _, item := range cmd.Items {
		var defID *string
		if item.FurnitureDefinitionID != "" {
			defID = &item.FurnitureDefinitionID
		}

		paramsJSON := []byte("{}")
		if item.Parameters != nil {
			p, err := json.Marshal(item.Parameters)
			if err != nil {
				return nil, fmt.Errorf("%w: parameters serialization error: %v", domain.ErrSerializationFailed, err)
			}
			paramsJSON = p
		}
		materialsJSON := []byte("{}")
		if item.MaterialChoices != nil {
			m, err := json.Marshal(item.MaterialChoices)
			if err != nil {
				return nil, fmt.Errorf("%w: material_choices serialization error: %v", domain.ErrSerializationFailed, err)
			}
			materialsJSON = m
		}
		transformJSON, err := json.Marshal(item.Transform)
		if err != nil {
			return nil, fmt.Errorf("%w: transform serialization error: %v", domain.ErrSerializationFailed, err)
		}
		var locatorJSON []byte
		if item.TechnicalClientLocator != nil {
			l, err := json.Marshal(item.TechnicalClientLocator)
			if err != nil {
				return nil, fmt.Errorf("%w: technical_client_locator serialization error: %v", domain.ErrSerializationFailed, err)
			}
			locatorJSON = l
		}

		_, err = s.db(ctx).Exec(ctx, `
			INSERT INTO design_working_items (
				organization_id, project_id, design_id,
				furniture_instance_id, furniture_definition_id, definition_version,
				parameters, material_choices, transform, room_id, technical_client_locator,
				created_at, updated_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
		`, designOrgID, projectID, cmd.DesignID,
			item.FurnitureInstanceID, defID, item.DefinitionVersion,
			paramsJSON, materialsJSON, transformJSON, item.RoomID, locatorJSON,
		)
		if err != nil {
			return nil, fmt.Errorf("insert working item: %w", err)
		}
	}

	// 6. Update design_working_copies
	actor := nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx))
	var baseRevToSet *string = cmd.BaseRevisionID
	_, err = s.db(ctx).Exec(ctx, `
		INSERT INTO design_working_copies (design_id, organization_id, project_id, base_revision_id, source_type, updated_at, updated_by)
		VALUES ($1, $2, $3, $4, $5, NOW(), $6)
		ON CONFLICT (design_id) DO UPDATE SET
			base_revision_id = CASE WHEN $7::boolean THEN EXCLUDED.base_revision_id ELSE design_working_copies.base_revision_id END,
			source_type = EXCLUDED.source_type,
			updated_at = NOW(),
			updated_by = EXCLUDED.updated_by
	`, cmd.DesignID, designOrgID, projectID, baseRevToSet, sourceType, actor, cmd.BaseRevisionID != nil)
	if err != nil {
		return nil, fmt.Errorf("update design working copy: %w", err)
	}

	return s.GetDesignWorkingCopy(ctx, cmd.DesignID)
}

func (s *PostgresStore) ResetDesignWorkingCopy(ctx context.Context, cmd ResetDesignWorkingCopyCommand) (*domain.DesignWorkingCopy, error) {
	if !isValidUUID(cmd.DesignID) {
		return nil, domain.ErrDesignNotFound
	}
	if !isValidUUID(cmd.RevisionID) {
		return nil, domain.ErrDesignRevisionNotFound
	}

	if transactionFromContext(ctx) == nil {
		var res *domain.DesignWorkingCopy
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			r, err := s.ResetDesignWorkingCopy(txCtx, cmd)
			if err != nil {
				return err
			}
			res = r
			return nil
		})
		return res, err
	}

	// 1. Lock designs row
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

	// 2. Verify revision exists for this design
	var revSourceType string
	err = s.db(ctx).QueryRow(ctx, `
		SELECT source_type
		FROM design_revisions
		WHERE id = $1 AND design_id = $2
	`, cmd.RevisionID, cmd.DesignID).Scan(&revSourceType)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignRevisionNotFound
		}
		return nil, err
	}

	// 3. Delete existing working items
	_, err = s.db(ctx).Exec(ctx, `DELETE FROM design_working_items WHERE design_id = $1`, cmd.DesignID)
	if err != nil {
		return nil, fmt.Errorf("delete working items on reset: %w", err)
	}

	// 4. Copy from revision items into working items
	_, err = s.db(ctx).Exec(ctx, `
		INSERT INTO design_working_items (
			organization_id, project_id, design_id,
			furniture_instance_id, furniture_definition_id, definition_version,
			parameters, material_choices, transform, room_id, technical_client_locator,
			created_at, updated_at
		)
		SELECT organization_id, project_id, $1,
		       furniture_instance_id, furniture_definition_id, definition_version,
		       parameters, material_choices, transform, room_id, technical_client_locator,
		       NOW(), NOW()
		FROM design_revision_items
		WHERE design_revision_id = $2
	`, cmd.DesignID, cmd.RevisionID)
	if err != nil {
		return nil, fmt.Errorf("copy revision items to working items: %w", err)
	}

	// 5. Update working copy metadata
	actor := nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx))
	_, err = s.db(ctx).Exec(ctx, `
		INSERT INTO design_working_copies (design_id, organization_id, project_id, base_revision_id, source_type, updated_at, updated_by)
		VALUES ($1, $2, $3, $4, $5, NOW(), $6)
		ON CONFLICT (design_id) DO UPDATE SET
			base_revision_id = EXCLUDED.base_revision_id,
			source_type = EXCLUDED.source_type,
			updated_at = NOW(),
			updated_by = EXCLUDED.updated_by
	`, cmd.DesignID, designOrgID, projectID, cmd.RevisionID, revSourceType, actor)
	if err != nil {
		return nil, fmt.Errorf("update design working copy on reset: %w", err)
	}

	return s.GetDesignWorkingCopy(ctx, cmd.DesignID)
}

// ModelBindingContext aggregates the authoritative Project/Design working
// context that a SketchUp model binding candidate must be validated against
// (#388 / DT-4, digital-thread §12). Reads are RLS-scoped: a project, design,
// revision or organization invisible to the tenant reads as not found, so
// foreign and cross-project objects fail indistinguishably.
type ModelBindingContext struct {
	OrganizationID            string
	OrganizationName          string
	ProjectID                 string
	ProjectName               string
	Design                    domain.Design
	WorkingCopyBaseRevisionID *string
	WorkingCopyUpdatedAt      time.Time
	BaseRevisionNumber        *int
}

// GetModelBindingContext resolves the exact organization/project/design
// working truth for the model-binding validation endpoint. baseRevisionID,
// when provided, is the base the client's stored binding expects; it must
// exist and belong to the same design or the read fails closed with
// ErrDesignRevisionNotFound. Mismatches between the client base and the
// authoritative working-copy base are NOT resolved here: the response carries
// the authoritative base and the client derives the stale state (#388).
func (s *PostgresStore) GetModelBindingContext(ctx context.Context, projectID, designID string, baseRevisionID *string) (*ModelBindingContext, error) {
	if !isValidUUID(projectID) || !isValidUUID(designID) {
		return nil, domain.ErrDesignNotFound
	}
	if baseRevisionID != nil && *baseRevisionID != "" && !isValidUUID(*baseRevisionID) {
		return nil, domain.ErrDesignRevisionNotFound
	}

	out := &ModelBindingContext{ProjectID: projectID}

	// 1. Project + owning organization (display summary for the plugin dialog).
	err := s.db(ctx).QueryRow(ctx, `
		SELECT p.name, p.organization_id::text, o.name
		FROM projects p
		JOIN organizations o ON o.id = p.organization_id
		WHERE p.id = $1
	`, projectID).Scan(&out.ProjectName, &out.OrganizationID, &out.OrganizationName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignNotFound
		}
		return nil, fmt.Errorf("resolve binding project: %w", err)
	}

	// 2. Design must exist AND belong to the exact path project. A design from
	// another project (or another organization, hidden by RLS) is uniformly
	// not-found — never a partial context (#388 negative proofs).
	design, err := scanDesign(s.db(ctx).QueryRow(ctx, `
		SELECT `+designColumns+`
		FROM designs
		WHERE id = $1 AND project_id = $2
	`, designID, projectID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignNotFound
		}
		return nil, fmt.Errorf("resolve binding design: %w", err)
	}
	out.Design = *design

	// 3. Authoritative working-copy base (absent on a fresh design).
	var wcBase *string
	var wcUpdatedAt *time.Time
	err = s.db(ctx).QueryRow(ctx, `
		SELECT base_revision_id::text, updated_at
		FROM design_working_copies
		WHERE design_id = $1
	`, designID).Scan(&wcBase, &wcUpdatedAt)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("resolve binding working copy: %w", err)
	}
	if wcBase != nil {
		out.WorkingCopyBaseRevisionID = wcBase
	}
	if wcUpdatedAt != nil {
		out.WorkingCopyUpdatedAt = *wcUpdatedAt
	} else {
		out.WorkingCopyUpdatedAt = design.UpdatedAt
	}

	// 4. Revision number of the authoritative base, when one exists.
	if out.WorkingCopyBaseRevisionID != nil {
		var revNum int
		err = s.db(ctx).QueryRow(ctx, `
			SELECT revision_number
			FROM design_revisions
			WHERE id = $1 AND design_id = $2
		`, *out.WorkingCopyBaseRevisionID, designID).Scan(&revNum)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, domain.ErrDesignRevisionNotFound
			}
			return nil, fmt.Errorf("resolve binding base revision: %w", err)
		}
		out.BaseRevisionNumber = &revNum
	}

	// 5. When the client already carries a binding base, that revision must
	// exist and belong to this design. Unknown or foreign revisions are
	// rejected instead of silently re-based.
	if baseRevisionID != nil && *baseRevisionID != "" {
		var revDesignID string
		err = s.db(ctx).QueryRow(ctx, `
			SELECT design_id FROM design_revisions WHERE id = $1
		`, *baseRevisionID).Scan(&revDesignID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, domain.ErrDesignRevisionNotFound
			}
			return nil, fmt.Errorf("validate client binding base: %w", err)
		}
		if revDesignID != designID {
			return nil, domain.ErrDesignRevisionNotFound
		}
	}

	return out, nil
}
