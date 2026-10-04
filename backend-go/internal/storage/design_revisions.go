package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"log/slog"
)

// Contrato: DesignRevision inmutable — scanners, pipeline de publicación
// (#392 staged incluido), numeración de revisiones y lecturas exactas.
func scanDesignRevision(row pgx.Row) (*domain.DesignRevision, error) {
	var r domain.DesignRevision
	var rawDefaults []byte
	if err := row.Scan(
		&r.ID, &r.OrganizationID, &r.ProjectID, &r.DesignID,
		&r.RevisionNumber, &r.ParentRevisionID,
		&r.SourceType, &r.Status, &r.CreatedBy,
		&r.CreatedAt, &r.ApprovedBy, &r.ApprovedAt,
		&r.CreatedByDisplayName, &r.ApprovedByDisplayName,
		&rawDefaults, &r.EffectiveLibraryReleaseID,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignRevisionNotFound
		}
		return nil, err
	}
	if len(rawDefaults) > 0 && string(rawDefaults) != "null" {
		var defaults domain.DesignAuthoringDefaults
		if err := json.Unmarshal(rawDefaults, &defaults); err != nil {
			return nil, fmt.Errorf("%w: read back authoring defaults snapshot: %v", domain.ErrSerializationFailed, err)
		}
		normalized := defaults.Normalize()
		r.AuthoringDefaultsSnapshot = &normalized
	}
	return &r, nil
}

const designRevisionItemColumns = `
	id, organization_id, project_id, design_revision_id,
	furniture_instance_id, COALESCE(furniture_definition_id::text, ''),
	definition_version, parameters, material_choices, material_choice_sources, material_choice_modes,
	transform, COALESCE(room_id, ''), technical_client_locator,
	created_at, presentation_snapshot`

func scanDesignRevisionItem(row pgx.Row) (*domain.DesignRevisionItem, error) {
	var item domain.DesignRevisionItem
	var rawParams, rawMaterials, rawSources, rawModes, rawTransform, rawPresentation []byte
	var rawLocator []byte
	if err := row.Scan(
		&item.ID, &item.OrganizationID, &item.ProjectID, &item.DesignRevisionID,
		&item.FurnitureInstanceID, &item.FurnitureDefinitionID,
		&item.DefinitionVersion, &rawParams, &rawMaterials, &rawSources, &rawModes,
		&rawTransform, &item.RoomID, &rawLocator,
		&item.CreatedAt, &rawPresentation,
	); err != nil {
		return nil, err
	}
	if len(rawModes) > 0 && string(rawModes) != "null" {
		if err := json.Unmarshal(rawModes, &item.MaterialChoiceModes); err != nil {
			return nil, fmt.Errorf("%w: read back material choice modes: %v", domain.ErrSerializationFailed, err)
		}
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
	if len(rawSources) > 0 && string(rawSources) != "null" {
		if err := json.Unmarshal(rawSources, &item.MaterialChoiceSources); err != nil {
			return nil, fmt.Errorf("%w: read back material choice sources: %v", domain.ErrSerializationFailed, err)
		}
	}
	presentation, err := domain.DecodeDesignRevisionPresentationSnapshot(rawPresentation)
	if err != nil {
		return nil, err
	}
	item.PresentationSnapshot = presentation
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
	definition_version, parameters, material_choices, material_choice_sources, material_choice_modes,
	transform, COALESCE(room_id, ''), technical_client_locator,
	created_at, updated_at`

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

	// The publish core below is shared with the #392 artifact finalize path
	// (FinalizeDesignPublish) so revision numbering, fail-closed optimistic
	// concurrency and the working-copy snapshot semantics have exactly one
	// implementation (§17: reutiliza la lógica concurrency-safe de #387).
	designOrgID, projectID, err := s.lockActiveDesignForPublish(ctx, cmd.DesignID)
	if err != nil {
		return nil, err
	}

	wcBaseRevID, _, authoringDefaults, err := s.loadWorkingCopyBaseForPublish(ctx, cmd.DesignID)
	if err != nil {
		return nil, err
	}

	nextRevisionNum, effectiveParentID, err := s.resolveRevisionNumbering(ctx, cmd.DesignID, cmd.BaseRevisionID, wcBaseRevID)
	if err != nil {
		return nil, err
	}

	itemsToPublish, err := s.loadWorkingItemsForPublish(ctx, cmd.DesignID)
	if err != nil {
		return nil, err
	}
	if err := s.validateWorkingItemsForPublish(ctx, projectID, itemsToPublish); err != nil {
		return nil, err
	}
	// #784: every newly published item freezes explicit inheritance modes in
	// strict parity with its materialized choices — no silent synthesis at
	// the immutability boundary.
	for _, item := range itemsToPublish {
		if err := domain.ValidateDesignMaterialChoiceModes(item.MaterialChoices, item.MaterialChoiceModes); err != nil {
			return nil, fmt.Errorf("%w: item %s", err, item.FurnitureInstanceID)
		}
	}
	if err := s.buildDesignRevisionPresentation(ctx, designOrgID, projectID, itemsToPublish); err != nil {
		return nil, err
	}

	rev, err := s.insertDesignRevisionAndItems(ctx, designOrgID, projectID, cmd.DesignID,
		nextRevisionNum, effectiveParentID, cmd.SourceType, cmd.ActorUserID, authoringDefaults, itemsToPublish)
	if err != nil {
		return nil, err
	}

	pinnedAssets, err := s.freezeDesignRevisionHardwareAssets(ctx, designOrgID, projectID, rev.ID, itemsToPublish)
	if err != nil {
		return nil, err
	}

	if err := s.advanceWorkingCopyBaseForPublish(ctx, cmd.DesignID, designOrgID, projectID, rev, cmd.ActorUserID); err != nil {
		return nil, err
	}

	if err := s.auditDesignRevisionPublished(ctx, rev, cmd.ActorUserID, cmd.IP, cmd.RequestID, map[string]interface{}{
		"hardware_asset_pins": pinnedAssets,
	}); err != nil {
		return nil, err
	}

	return rev, nil
}

// lockActiveDesignForPublish takes the design row lock that serializes every
// publication and revision-numbering decision for one design (#387 / #392).
func (s *PostgresStore) lockActiveDesignForPublish(ctx context.Context, designID string) (string, string, error) {
	var designOrgID, projectID, designStatus string
	err := s.db(ctx).QueryRow(ctx, `
		SELECT organization_id, project_id, status
		FROM designs
		WHERE id = $1
		FOR UPDATE
	`, designID).Scan(&designOrgID, &projectID, &designStatus)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", domain.ErrDesignNotFound
		}
		return "", "", err
	}
	if designStatus != string(domain.DesignStatusActive) {
		return "", "", domain.ErrDesignNotActive
	}

	actorOrg := OrgFromCtx(ctx)
	if actorOrg != "" && actorOrg != designOrgID {
		return "", "", domain.ErrFurnitureInstanceProjectNotWritable
	}
	return designOrgID, projectID, nil
}

// loadWorkingCopyBaseForPublish locks the working copy row: the working copy
// is the sole mutable authoring authority and its base_revision_id is the
// concurrency authority at publish time. The #784 authoring defaults ride the
// same locked read so the revision snapshot freezes the exact publish-moment
// defaults atomically with the items.
func (s *PostgresStore) loadWorkingCopyBaseForPublish(ctx context.Context, designID string) (*string, string, domain.DesignAuthoringDefaults, error) {
	var wcBaseRevID *string
	var wcSourceType string
	var rawDefaults []byte
	err := s.db(ctx).QueryRow(ctx, `
		SELECT base_revision_id::text, source_type, authoring_defaults
		FROM design_working_copies
		WHERE design_id = $1
		FOR UPDATE
	`, designID).Scan(&wcBaseRevID, &wcSourceType, &rawDefaults)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, "manual", domain.DesignAuthoringDefaults{}.Normalize(), nil
		}
		return nil, "", domain.DesignAuthoringDefaults{}, err
	}
	defaults := domain.DesignAuthoringDefaults{}.Normalize()
	if len(rawDefaults) > 0 && string(rawDefaults) != "null" {
		if err := json.Unmarshal(rawDefaults, &defaults); err != nil {
			return nil, "", domain.DesignAuthoringDefaults{}, fmt.Errorf("%w: read authoring defaults for publish: %v", domain.ErrSerializationFailed, err)
		}
		defaults = defaults.Normalize()
	}
	return wcBaseRevID, wcSourceType, defaults, nil
}

// resolveRevisionNumbering enforces the single fail-closed optimistic
// concurrency rule of #387: the authoritative base is
// design_working_copies.base_revision_id; when revisions exist the client
// base is required and MUST equal both the working-copy base and the latest
// revision. The parent of the next revision is always derived — no branching.
func (s *PostgresStore) resolveRevisionNumbering(ctx context.Context, designID, clientBaseRevisionID string, wcBaseRevID *string) (int, *string, error) {
	var latestRevID string
	var latestRevNum int
	err := s.db(ctx).QueryRow(ctx, `
		SELECT id, revision_number
		FROM design_revisions
		WHERE design_id = $1
		ORDER BY revision_number DESC
		LIMIT 1
	`, designID).Scan(&latestRevID, &latestRevNum)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// No previous revision exists: this will be R1.
			// Semántica: workingCopy.baseRevisionId == null -> publish R1 allowed.
			if wcBaseRevID != nil && *wcBaseRevID != "" {
				return 0, nil, fmt.Errorf("%w: working copy base revision is %s but design has no published revisions", domain.ErrDesignRevisionConflict, *wcBaseRevID)
			}
			if clientBaseRevisionID != "" {
				return 0, nil, fmt.Errorf("%w: base revision specified (%s) but design has no previous revisions", domain.ErrDesignRevisionConflict, clientBaseRevisionID)
			}
			return 1, nil, nil
		}
		return 0, nil, err
	}

	// Previous revision exists: fail-closed optimistic concurrency.
	// Authority is design_working_copies.base_revision_id:
	// latest = R7: workingCopy.baseRevisionId MUST equal R7.
	if wcBaseRevID == nil || *wcBaseRevID == "" {
		return 0, nil, fmt.Errorf("%w: working copy base revision is missing/null when revisions already exist; latest is %s (R%d)", domain.ErrDesignRevisionConflict, latestRevID, latestRevNum)
	}
	if *wcBaseRevID != latestRevID {
		return 0, nil, fmt.Errorf("%w: working copy base revision %s is stale; latest is %s (R%d)", domain.ErrDesignRevisionConflict, *wcBaseRevID, latestRevID, latestRevNum)
	}
	// Base revision ID is required for optimistic concurrency when revisions exist.
	if clientBaseRevisionID == "" {
		return 0, nil, fmt.Errorf("%w: base revision is required when revisions already exist; latest is %s (R%d)", domain.ErrDesignRevisionConflict, latestRevID, latestRevNum)
	}
	if clientBaseRevisionID != latestRevID {
		return 0, nil, fmt.Errorf("%w: client base revision %s is stale; latest is %s (R%d)", domain.ErrDesignRevisionConflict, clientBaseRevisionID, latestRevID, latestRevNum)
	}
	// Linear parent chain: parent revision is derived from latest/base revision.
	return latestRevNum + 1, &latestRevID, nil
}

// loadWorkingItemsForPublish resolves the items to publish ALWAYS from the
// persistent working copy (single source of authoring truth) — never from a
// client-supplied payload or from scanning the .skp artifact.
func (s *PostgresStore) loadWorkingItemsForPublish(ctx context.Context, designID string) ([]PublishDesignRevisionItemCommand, error) {
	wRows, err := s.db(ctx).Query(ctx, `
		SELECT furniture_instance_id, COALESCE(furniture_definition_id::text, ''),
		       definition_version, parameters, material_choices, material_choice_sources, material_choice_modes,
		       transform, COALESCE(room_id, ''), technical_client_locator
		FROM design_working_items
		WHERE design_id = $1
		ORDER BY created_at ASC
	`, designID)
	if err != nil {
		return nil, fmt.Errorf("load working items for publish: %w", err)
	}
	defer wRows.Close()

	var itemsToPublish []PublishDesignRevisionItemCommand
	for wRows.Next() {
		var itm PublishDesignRevisionItemCommand
		var rawP, rawM, rawS, rawModes, rawT, rawL []byte
		var defIDStr string
		if err := wRows.Scan(
			&itm.FurnitureInstanceID, &defIDStr,
			&itm.DefinitionVersion, &rawP, &rawM, &rawS, &rawModes, &rawT,
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
		if len(rawS) > 0 && string(rawS) != "null" {
			if err := json.Unmarshal(rawS, &itm.MaterialChoiceSources); err != nil {
				return nil, fmt.Errorf("%w: unmarshal working item material_choice_sources: %v", domain.ErrSerializationFailed, err)
			}
		}
		if len(rawModes) > 0 && string(rawModes) != "null" {
			if err := json.Unmarshal(rawModes, &itm.MaterialChoiceModes); err != nil {
				return nil, fmt.Errorf("%w: unmarshal working item material_choice_modes: %v", domain.ErrSerializationFailed, err)
			}
		}
		if itm.MaterialChoiceModes == nil {
			itm.MaterialChoiceModes = make(map[string]domain.DesignMaterialChoiceMode)
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
	return itemsToPublish, nil
}

// validateWorkingItemsForPublish enforces the item invariants of a snapshot:
// unique FurnitureInstances (I11) belonging to the same project (I10) and
// not in a terminal lifecycle state.
func (s *PostgresStore) validateWorkingItemsForPublish(ctx context.Context, projectID string, itemsToPublish []PublishDesignRevisionItemCommand) error {
	seenInstances := make(map[string]struct{}, len(itemsToPublish))
	instanceIDs := make([]string, 0, len(itemsToPublish))
	for _, item := range itemsToPublish {
		if !isValidUUID(item.FurnitureInstanceID) {
			return domain.ErrInvalidDesignCommand
		}
		if _, exists := seenInstances[item.FurnitureInstanceID]; exists {
			// Duplicate FI within one revision is rejected (I11).
			return fmt.Errorf("%w: furniture instance %s appears more than once", domain.ErrDuplicateFurnitureInstanceInRevision, item.FurnitureInstanceID)
		}
		seenInstances[item.FurnitureInstanceID] = struct{}{}
		instanceIDs = append(instanceIDs, item.FurnitureInstanceID)
	}

	if len(instanceIDs) == 0 {
		return nil
	}

	// Validate that all instances belong to the SAME project and are not removed/cancelled.
	rows, err := s.db(ctx).Query(ctx, `
		SELECT id, project_id, lifecycle_status
		FROM furniture_instances
		WHERE id = ANY($1)
	`, instanceIDs)
	if err != nil {
		return err
	}
	defer rows.Close()

	foundMap := make(map[string]struct {
		projectID string
		lifecycle string
	})
	for rows.Next() {
		var id, pID, lifecycle string
		if err := rows.Scan(&id, &pID, &lifecycle); err != nil {
			return err
		}
		foundMap[id] = struct {
			projectID string
			lifecycle string
		}{projectID: pID, lifecycle: lifecycle}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, fiID := range instanceIDs {
		info, found := foundMap[fiID]
		if !found {
			return fmt.Errorf("%w: instance %s not found", ErrFurnitureInstanceNotFound, fiID)
		}
		if info.projectID != projectID {
			// Same-project invariant (I10).
			return fmt.Errorf("%w: instance %s belongs to project %s, not %s", domain.ErrCrossProjectFurnitureInstance, fiID, info.projectID, projectID)
		}
		if domain.FurnitureInstanceLifecycleTerminal(domain.FurnitureInstanceLifecycle(info.lifecycle)) {
			return fmt.Errorf("%w: instance %s is %s", domain.ErrFurnitureInstanceLifecycleConflict, fiID, info.lifecycle)
		}
	}
	return nil
}

// insertDesignRevisionAndItems writes the immutable revision header and its
// item snapshots with strict serialization checks. The header freezes the
// working copy's #784 authoring defaults; each item freezes its explicit
// inheritance modes (required for new publishes, in parity with choices).
func (s *PostgresStore) insertDesignRevisionAndItems(ctx context.Context, designOrgID, projectID, designID string,
	nextRevisionNum int, effectiveParentID *string, sourceType domain.DesignRevisionSourceType,
	actorUserID string, authoringDefaults domain.DesignAuthoringDefaults, itemsToPublish []PublishDesignRevisionItemCommand) (*domain.DesignRevision, error) {
	var createdBy *string
	if isValidUUID(actorUserID) {
		createdBy = &actorUserID
	}
	actorFallback := "Sistema"
	if isValidUUID(actorUserID) {
		actorFallback = "Usuario no disponible"
	}
	createdByDisplayName := actorDisplayName(ctx, s, actorUserID, actorFallback)

	defaultsJSON, err := json.Marshal(authoringDefaults.Normalize())
	if err != nil {
		return nil, fmt.Errorf("%w: authoring_defaults_snapshot serialization error: %v", domain.ErrSerializationFailed, err)
	}

	var effectiveLibraryReleaseID *uuid.UUID
	if orgUUID, parseErr := uuid.Parse(designOrgID); parseErr == nil {
		if effectiveRelease, libErr := s.GetEffectiveReleaseForOrg(ctx, orgUUID); libErr == nil && effectiveRelease != nil {
			effectiveLibraryReleaseID = &effectiveRelease.ID
		} else {
			slog.WarnContext(ctx, "design revision publishing without library pin — no published library release available",
				"organization_id", designOrgID,
				"issue", "#772")
		}
	}

	var rev domain.DesignRevision
	var rawRevDefaults []byte
	err = s.db(ctx).QueryRow(ctx, `
		INSERT INTO design_revisions (
			organization_id, project_id, design_id, revision_number,
			parent_revision_id, source_type, status, created_by, created_by_display_name,
			authoring_defaults_snapshot, effective_library_release_id
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING `+designRevisionColumns,
		designOrgID, projectID, designID, nextRevisionNum,
		effectiveParentID, sourceType, domain.DesignRevisionStatusPublished, createdBy, createdByDisplayName,
		defaultsJSON, effectiveLibraryReleaseID,
	).Scan(
		&rev.ID, &rev.OrganizationID, &rev.ProjectID, &rev.DesignID,
		&rev.RevisionNumber, &rev.ParentRevisionID,
		&rev.SourceType, &rev.Status, &rev.CreatedBy,
		&rev.CreatedAt, &rev.ApprovedBy, &rev.ApprovedAt,
		&rev.CreatedByDisplayName, &rev.ApprovedByDisplayName, &rawRevDefaults,
		&rev.EffectiveLibraryReleaseID,
	)
	if err != nil {
		return nil, fmt.Errorf("insert design revision: %w", err)
	}
	if len(rawRevDefaults) > 0 && string(rawRevDefaults) != "null" {
		var frozen domain.DesignAuthoringDefaults
		if err := json.Unmarshal(rawRevDefaults, &frozen); err != nil {
			return nil, fmt.Errorf("%w: read back authoring defaults snapshot: %v", domain.ErrSerializationFailed, err)
		}
		normalized := frozen.Normalize()
		rev.AuthoringDefaultsSnapshot = &normalized
	}

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
		var sourcesJSON []byte
		if itemCmd.MaterialChoiceSources != nil {
			sourcesJSON, err = json.Marshal(itemCmd.MaterialChoiceSources)
			if err != nil {
				return nil, fmt.Errorf("%w: material_choice_sources serialization error: %v", domain.ErrSerializationFailed, err)
			}
		}
		// #784: new publishes REQUIRE explicit inheritance modes — the same
		// required-snapshot discipline as presentation_snapshot. Legacy
		// revision items (pre-contract) read NULL and stay NULL forever.
		if itemCmd.MaterialChoiceModes == nil {
			return nil, fmt.Errorf("%w: material_choice_modes is required for newly published revision items", domain.ErrSerializationFailed)
		}
		modesJSON, err := json.Marshal(itemCmd.MaterialChoiceModes)
		if err != nil {
			return nil, fmt.Errorf("%w: material_choice_modes serialization error: %v", domain.ErrSerializationFailed, err)
		}
		if itemCmd.PresentationSnapshot == nil {
			return nil, fmt.Errorf("%w: presentation_snapshot is required for newly published revision items", domain.ErrSerializationFailed)
		}
		presentationJSON, err := json.Marshal(itemCmd.PresentationSnapshot)
		if err != nil {
			return nil, fmt.Errorf("%w: presentation_snapshot serialization error: %v", domain.ErrSerializationFailed, err)
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
		var rawP, rawM, rawS, rawModes, rawT, rawL, rawPresentation []byte
		err = s.db(ctx).QueryRow(ctx, `
			INSERT INTO design_revision_items (
				organization_id, project_id, design_revision_id,
				furniture_instance_id, furniture_definition_id, definition_version,
				parameters, material_choices, material_choice_sources, material_choice_modes, transform, room_id, technical_client_locator,
				presentation_snapshot
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
			RETURNING `+designRevisionItemColumns,
			designOrgID, projectID, rev.ID,
			itemCmd.FurnitureInstanceID, defID, itemCmd.DefinitionVersion,
			paramsJSON, materialsJSON, sourcesJSON, modesJSON, transformJSON, itemCmd.RoomID, locatorJSON, presentationJSON,
		).Scan(
			&insertedItem.ID, &insertedItem.OrganizationID, &insertedItem.ProjectID, &insertedItem.DesignRevisionID,
			&insertedItem.FurnitureInstanceID, &insertedItem.FurnitureDefinitionID,
			&insertedItem.DefinitionVersion, &rawP, &rawM, &rawS, &rawModes, &rawT, &insertedItem.RoomID, &rawL,
			&insertedItem.CreatedAt, &rawPresentation,
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
		if len(rawS) > 0 && string(rawS) != "null" {
			if err := json.Unmarshal(rawS, &insertedItem.MaterialChoiceSources); err != nil {
				return nil, fmt.Errorf("%w: unmarshal inserted material_choice_sources: %v", domain.ErrSerializationFailed, err)
			}
		}
		if len(rawModes) > 0 && string(rawModes) != "null" {
			if err := json.Unmarshal(rawModes, &insertedItem.MaterialChoiceModes); err != nil {
				return nil, fmt.Errorf("%w: unmarshal inserted material_choice_modes: %v", domain.ErrSerializationFailed, err)
			}
		}
		insertedItem.PresentationSnapshot, err = domain.DecodeDesignRevisionPresentationSnapshot(rawPresentation)
		if err != nil {
			return nil, err
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
	return &rev, nil
}

// advanceWorkingCopyBaseForPublish moves the working copy base to the newly
// published revision. Working items are NOT cleared — authoring continues
// from the new base (digital-thread §8, DT-8 §29).
func (s *PostgresStore) advanceWorkingCopyBaseForPublish(ctx context.Context, designID, designOrgID, projectID string, rev *domain.DesignRevision, actorUserID string) error {
	actor := nonEmptyOrDefault(actorUserID, tenantActorUserID(ctx))
	_, err := s.db(ctx).Exec(ctx, `
		INSERT INTO design_working_copies (design_id, organization_id, project_id, base_revision_id, source_type, updated_at, updated_by)
		VALUES ($1, $2, $3, $4, $5, NOW(), $6)
		ON CONFLICT (design_id) DO UPDATE SET
			base_revision_id = EXCLUDED.base_revision_id,
			source_type = EXCLUDED.source_type,
			updated_at = NOW(),
			updated_by = EXCLUDED.updated_by
	`, designID, designOrgID, projectID, rev.ID, rev.SourceType, actor)
	if err != nil {
		return fmt.Errorf("advance working copy base revision: %w", err)
	}
	return nil
}

// auditDesignRevisionPublished records the durable publication event. Extra
// details (artifact references, publish session) are merged by the #392
// finalize path.
func (s *PostgresStore) auditDesignRevisionPublished(ctx context.Context, rev *domain.DesignRevision, actorUserID, ip, requestID string, extra map[string]interface{}) error {
	details := map[string]interface{}{
		"design_revision_id": rev.ID,
		"design_id":          rev.DesignID,
		"project_id":         rev.ProjectID,
		"revision_number":    rev.RevisionNumber,
		"parent_revision_id": rev.ParentRevisionID,
		"source_type":        string(rev.SourceType),
		"item_count":         len(rev.Items),
	}
	for k, v := range extra {
		details[k] = v
	}
	if err := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
		EventType:      "design_revision_published",
		ActorUserID:    nonEmptyOrDefault(actorUserID, tenantActorUserID(ctx)),
		OrganizationID: rev.OrganizationID,
		IP:             ip,
		RequestID:      requestID,
		Details:        details,
	}); err != nil {
		return fmt.Errorf("audit design_revision_published: %w", err)
	}
	return nil
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

	// #392: published artifact metadata rides along on the revision detail
	// (§31 readback). Legacy artifact-less revisions simply carry none.
	artifacts, err := s.ListDesignRevisionArtifacts(ctx, designID, rev.ID)
	if err != nil {
		return nil, err
	}
	if artifacts != nil {
		rev.Artifacts = artifacts
	}
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
