package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"time"
)

// Contrato: working copy mutable del diseño — lectura, update, reset y
// assert de versión para gates de staleness (#784).
func scanDesignWorkingItem(row pgx.Row) (*domain.DesignWorkingItem, error) {
	var item domain.DesignWorkingItem
	var rawParams, rawMaterials, rawSources, rawModes, rawTransform []byte
	var rawLocator []byte
	if err := row.Scan(
		&item.ID, &item.OrganizationID, &item.ProjectID, &item.DesignID,
		&item.FurnitureInstanceID, &item.FurnitureDefinitionID,
		&item.DefinitionVersion, &rawParams, &rawMaterials, &rawSources, &rawModes,
		&rawTransform, &item.RoomID, &rawLocator,
		&item.CreatedAt, &item.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if len(rawModes) > 0 && string(rawModes) != "null" {
		if err := json.Unmarshal(rawModes, &item.MaterialChoiceModes); err != nil {
			return nil, fmt.Errorf("%w: read back material choice modes: %v", domain.ErrSerializationFailed, err)
		}
	}
	if item.MaterialChoiceModes == nil {
		item.MaterialChoiceModes = make(map[string]domain.DesignMaterialChoiceMode)
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
func (s *PostgresStore) GetDesignWorkingCopy(ctx context.Context, designID string) (*domain.DesignWorkingCopy, error) {
	if !isValidUUID(designID) {
		return nil, domain.ErrDesignNotFound
	}

	var wc domain.DesignWorkingCopy
	var baseRevID *string
	var rawDefaults []byte
	row := s.db(ctx).QueryRow(ctx, `
		SELECT design_id, organization_id, project_id, base_revision_id::text, source_type, updated_at, updated_by, authoring_defaults
		FROM design_working_copies
		WHERE design_id = $1
	`, designID)
	err := row.Scan(&wc.DesignID, &wc.OrganizationID, &wc.ProjectID, &baseRevID, &wc.SourceType, &wc.UpdatedAt, &wc.UpdatedBy, &rawDefaults)
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
	if len(rawDefaults) > 0 && string(rawDefaults) != "null" {
		var defaults domain.DesignAuthoringDefaults
		if err := json.Unmarshal(rawDefaults, &defaults); err != nil {
			return nil, fmt.Errorf("%w: read back authoring defaults: %v", domain.ErrSerializationFailed, err)
		}
		wc.AuthoringDefaults = defaults.Normalize()
	}
	wc.AuthoringDefaults = wc.AuthoringDefaults.Normalize()

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

// assertWorkingCopyVersion enforces the #810 write precondition under the
// caller's design-row lock. A nil token is only valid while no working-copy
// row exists (nothing to lose); a zero token records that the caller last read
// an ABSENT working copy and diverges once a row exists; any other token must
// equal the stored updated_at exactly.
func (s *PostgresStore) assertWorkingCopyVersion(ctx context.Context, designID string, expected *time.Time) error {
	var storedUpdatedAt *time.Time
	err := s.db(ctx).QueryRow(ctx, `
		SELECT updated_at FROM design_working_copies WHERE design_id = $1
	`, designID).Scan(&storedUpdatedAt)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	switch {
	case storedUpdatedAt != nil:
		if expected == nil {
			return ErrWorkingCopyPreconditionRequired
		}
		if expected.IsZero() || !expected.UTC().Equal(storedUpdatedAt.UTC()) {
			return ErrWorkingCopyVersionConflict
		}
	case expected != nil && !expected.IsZero():
		return ErrWorkingCopyVersionConflict
	}
	return nil
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
	// #784: Design authoring defaults travel as explicit intent — validated
	// fail-closed, persisted verbatim (never derived). Changing them never
	// touches items.
	if cmd.AuthoringDefaults != nil {
		if err := domain.ValidateDesignAuthoringDefaults(cmd.AuthoringDefaults.Normalize()); err != nil {
			return nil, err
		}
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

	// 1.5 #810 write precondition, under the design-row lock.
	if err := s.assertWorkingCopyVersion(ctx, cmd.DesignID, cmd.ExpectedWorkingVersion); err != nil {
		return nil, err
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

	previousChoices := map[string]map[string]string{}
	previousSources := map[string]map[string]domain.DesignMaterialProvenance{}
	previousModes := map[string]map[string]domain.DesignMaterialChoiceMode{}
	// #977: the full previous item (parameters included) feeds the authoring
	// snapshot written when this update drops the item — the delete intent
	// must not be the last writer of the unit's authored state.
	previousParameters := map[string]map[string]any{}
	rows, err := s.db(ctx).Query(ctx, `
		SELECT furniture_instance_id::text, material_choices, material_choice_sources, material_choice_modes, parameters
		FROM design_working_items WHERE design_id = $1
	`, cmd.DesignID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		var choicesRaw, sourcesRaw, modesRaw, parametersRaw []byte
		if err := rows.Scan(&id, &choicesRaw, &sourcesRaw, &modesRaw, &parametersRaw); err != nil {
			rows.Close()
			return nil, err
		}
		var choices map[string]string
		var sources map[string]domain.DesignMaterialProvenance
		var modes map[string]domain.DesignMaterialChoiceMode
		var parameters map[string]any
		_ = json.Unmarshal(choicesRaw, &choices)
		if len(sourcesRaw) > 0 && string(sourcesRaw) != "null" {
			_ = json.Unmarshal(sourcesRaw, &sources)
		}
		if len(modesRaw) > 0 && string(modesRaw) != "null" {
			_ = json.Unmarshal(modesRaw, &modes)
		}
		if len(parametersRaw) > 0 && string(parametersRaw) != "null" {
			_ = json.Unmarshal(parametersRaw, &parameters)
		}
		previousChoices[id], previousSources[id], previousModes[id] = choices, sources, modes
		previousParameters[id] = parameters
	}
	rows.Close()

	// 3. Validate items
	seenFI := make(map[string]bool)
	var consumptionCatalog *domain.Catalog
	for i := range cmd.Items {
		item := cmd.Items[i]
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
		// #784: a PRESENT modes statement is client-authorable intent validated
		// fail-closed (strict parity — partial statements, unknown modes and
		// modes without a materialized choice all reject). An ABSENT field is
		// the legacy writer shape: the persisted lineage is PRESERVED for
		// unchanged values and only an explicitly changed materialized value
		// becomes 'override' (owner decision 2026-09-28) — equality detects
		// whether the legacy writer changed a value, never lineage itself.
		if item.MaterialChoiceModes == nil {
			cmd.Items[i].MaterialChoiceModes = domain.MergeLegacyMaterialChoiceModes(
				item.MaterialChoices, previousChoices[item.FurnitureInstanceID], previousModes[item.FurnitureInstanceID])
		} else if err := domain.ValidatePresentMaterialChoiceModes(item.MaterialChoices, item.MaterialChoiceModes); err != nil {
			return nil, fmt.Errorf("%w: item %s", err, item.FurnitureInstanceID)
		}
		// #826 converge-at-write boundary (human decision 2026-09-22, revised
		// from reject after test evidence broke #620/preflight-parity): incoming
		// choices are intersected with the definition's consumed roles before
		// persisting, so commercial seeds carrying unconsumable groups converge
		// to the physical truth instead of freezing release-blocked revisions.
		// The release gate stays the only hard fail-closed check.
		if len(item.MaterialChoices) > 0 {
			if consumptionCatalog == nil {
				catalog, err := s.GetFullCatalog(ctx)
				if err != nil {
					return nil, err
				}
				consumptionCatalog = &catalog
			}
			filtered, ok := engine.IntersectConsumedOptionChoices(domain.DesignRevisionItem{
				FurnitureInstanceID:   item.FurnitureInstanceID,
				FurnitureDefinitionID: item.FurnitureDefinitionID,
				DefinitionVersion:     item.DefinitionVersion,
				Parameters:            item.Parameters,
				MaterialChoices:       item.MaterialChoices,
			}, *consumptionCatalog)
			if ok {
				cmd.Items[i].MaterialChoices = filtered
				// Keep mode parity with the converged choices: a role the
				// definition does not consume drops its lineage statement too.
				filteredModes := make(map[string]domain.DesignMaterialChoiceMode, len(filtered))
				for role, mode := range cmd.Items[i].MaterialChoiceModes {
					if _, consumed := filtered[role]; consumed {
						filteredModes[role] = mode
					}
				}
				cmd.Items[i].MaterialChoiceModes = filteredModes
			}
		}
	}

	sourceType := cmd.SourceType
	if sourceType == "" {
		sourceType = domain.DesignRevisionSourceManual
	}

	quotedChoices := map[string]map[string]string{}
	rows, err = s.db(ctx).Query(ctx, `
		SELECT qri.furniture_instance_id::text, qri.material_choices
		FROM designs d
		JOIN quote_revision_items qri ON qri.quote_revision_id = d.source_quote_revision_id
		WHERE d.id = $1
	`, cmd.DesignID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		var choicesRaw []byte
		if err := rows.Scan(&id, &choicesRaw); err != nil {
			rows.Close()
			return nil, err
		}
		var choices map[string]string
		if err := json.Unmarshal(choicesRaw, &choices); err != nil {
			rows.Close()
			return nil, fmt.Errorf("%w: quoted material choices: %v", domain.ErrSerializationFailed, err)
		}
		quotedChoices[id] = choices
	}
	rows.Close()

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
		sources := make(map[string]domain.DesignMaterialProvenance, len(item.MaterialChoices))
		priorItemChoices, itemExisted := previousChoices[item.FurnitureInstanceID]
		for role, materialID := range item.MaterialChoices {
			if itemExisted && priorItemChoices[role] == materialID {
				if previousSources[item.FurnitureInstanceID][role] != "" {
					sources[role] = previousSources[item.FurnitureInstanceID][role]
				} else {
					sources[role] = domain.DesignMaterialProvenanceUnresolved
				}
			} else if !itemExisted && quotedChoices[item.FurnitureInstanceID][role] == materialID {
				sources[role] = domain.DesignMaterialProvenanceQuoted
			} else {
				sources[role] = domain.DesignMaterialProvenanceAuthored
			}
		}
		sourcesJSON, err := json.Marshal(sources)
		if err != nil {
			return nil, fmt.Errorf("%w: material_choice_sources serialization error: %v", domain.ErrSerializationFailed, err)
		}
		modesJSON, err := json.Marshal(item.MaterialChoiceModes)
		if err != nil {
			return nil, fmt.Errorf("%w: material_choice_modes serialization error: %v", domain.ErrSerializationFailed, err)
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
				parameters, material_choices, material_choice_sources, material_choice_modes, transform, room_id, technical_client_locator,
				created_at, updated_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
		`, designOrgID, projectID, cmd.DesignID,
			item.FurnitureInstanceID, defID, item.DefinitionVersion,
			paramsJSON, materialsJSON, sourcesJSON, modesJSON, transformJSON, item.RoomID, locatorJSON,
		)
		if err != nil {
			return nil, fmt.Errorf("insert working item: %w", err)
		}
	}

	// 5b. #977 authoring snapshots: this update is the conscious delete intent
	// (#810 Caso 1) for every previous item absent from the new set. The unit's
	// authored state would otherwise die with the dropped row — re-placement
	// could only seed finishes from a quote line the project may not have.
	// Same transaction as the drop; version/updated_at stay untouched so a
	// background sync can never poison a concurrent instance command's
	// If-Match. Terminal instances keep whatever snapshot they already carry.
	kept := make(map[string]bool, len(cmd.Items))
	for _, item := range cmd.Items {
		kept[item.FurnitureInstanceID] = true
	}
	for id, parameters := range previousParameters {
		if kept[id] || !isValidUUID(id) {
			continue
		}
		snapshot := domain.FurnitureInstanceAuthoringSnapshot{
			Parameters:      parameters,
			MaterialChoices: previousChoices[id],
		}
		if modes := previousModes[id]; len(modes) > 0 {
			snapshot.MaterialChoiceModes = modes
		}
		snapshotJSON, err := json.Marshal(snapshot)
		if err != nil {
			return nil, fmt.Errorf("%w: authoring snapshot serialization error: %v", domain.ErrSerializationFailed, err)
		}
		if _, err := s.db(ctx).Exec(ctx, `
			UPDATE furniture_instances
			SET authoring_snapshot = $1
			WHERE id = $2::uuid AND project_id = $3 AND lifecycle_status = 'active'
		`, snapshotJSON, id, projectID); err != nil {
			return nil, fmt.Errorf("snapshot dropped working item: %w", err)
		}
	}

	// 6. Update design_working_copies. #784: authoring_defaults follow the
	// same nil-keeps frontier as base_revision_id — a write that omits them
	// preserves the stored Design defaults; a write that carries them (even
	// an explicit empty block) replaces them. Items are never derived from or
	// mutated by defaults.
	actor := nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx))
	var baseRevToSet *string = cmd.BaseRevisionID
	defaultsToSet := domain.DesignAuthoringDefaults{}.Normalize()
	if cmd.AuthoringDefaults != nil {
		defaultsToSet = cmd.AuthoringDefaults.Normalize()
	}
	defaultsJSON, err := json.Marshal(defaultsToSet)
	if err != nil {
		return nil, fmt.Errorf("%w: authoring_defaults serialization error: %v", domain.ErrSerializationFailed, err)
	}
	_, err = s.db(ctx).Exec(ctx, `
		INSERT INTO design_working_copies (design_id, organization_id, project_id, base_revision_id, source_type, authoring_defaults, updated_at, updated_by)
		VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
		ON CONFLICT (design_id) DO UPDATE SET
			base_revision_id = CASE WHEN $8::boolean THEN EXCLUDED.base_revision_id ELSE design_working_copies.base_revision_id END,
			source_type = EXCLUDED.source_type,
			authoring_defaults = CASE WHEN $9::boolean THEN EXCLUDED.authoring_defaults ELSE design_working_copies.authoring_defaults END,
			updated_at = NOW(),
			updated_by = EXCLUDED.updated_by
	`, cmd.DesignID, designOrgID, projectID, baseRevToSet, sourceType, defaultsJSON, actor, cmd.BaseRevisionID != nil, cmd.AuthoringDefaults != nil)
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

	// 1.5 #810 write precondition, under the design-row lock.
	if err := s.assertWorkingCopyVersion(ctx, cmd.DesignID, cmd.ExpectedWorkingVersion); err != nil {
		return nil, err
	}

	// 2. Verify revision exists for this design and read its frozen #784
	// authoring defaults snapshot (legacy revisions read NULL ⇒ canonical
	// empty defaults — never the current mutable working defaults).
	var revSourceType string
	var rawRevDefaults []byte
	err = s.db(ctx).QueryRow(ctx, `
		SELECT source_type, authoring_defaults_snapshot
		FROM design_revisions
		WHERE id = $1 AND design_id = $2
	`, cmd.RevisionID, cmd.DesignID).Scan(&revSourceType, &rawRevDefaults)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignRevisionNotFound
		}
		return nil, err
	}
	revDefaults := domain.DesignAuthoringDefaults{}.Normalize()
	if len(rawRevDefaults) > 0 && string(rawRevDefaults) != "null" {
		if err := json.Unmarshal(rawRevDefaults, &revDefaults); err != nil {
			return nil, fmt.Errorf("%w: read revision authoring defaults on reset: %v", domain.ErrSerializationFailed, err)
		}
		revDefaults = revDefaults.Normalize()
	}
	revDefaultsJSON, err := json.Marshal(revDefaults)
	if err != nil {
		return nil, fmt.Errorf("%w: revision authoring defaults serialization error: %v", domain.ErrSerializationFailed, err)
	}

	// 3. Delete existing working items
	_, err = s.db(ctx).Exec(ctx, `DELETE FROM design_working_items WHERE design_id = $1`, cmd.DesignID)
	if err != nil {
		return nil, fmt.Errorf("delete working items on reset: %w", err)
	}

	// 4. Copy from revision items into working items. Legacy revision items
	// (modes NULL, pre-#784) reset to conservative 'override' for every
	// materialized role — the same synthesis the migration backfill applied,
	// materialized once at reset time, never derived from equality.
	_, err = s.db(ctx).Exec(ctx, `
		INSERT INTO design_working_items (
			organization_id, project_id, design_id,
			furniture_instance_id, furniture_definition_id, definition_version,
			parameters, material_choices, material_choice_sources, material_choice_modes, transform, room_id, technical_client_locator,
			created_at, updated_at
		)
		SELECT organization_id, project_id, $1,
		       furniture_instance_id, furniture_definition_id, definition_version,
		       parameters, material_choices, material_choice_sources,
		       COALESCE(
		           material_choice_modes,
		           (SELECT COALESCE(jsonb_object_agg(role, to_jsonb('override'::text)), '{}'::jsonb)
		            FROM jsonb_object_keys(material_choices) AS role)
		       ),
		       transform, room_id, technical_client_locator,
		       NOW(), NOW()
		FROM design_revision_items
		WHERE design_revision_id = $2
	`, cmd.DesignID, cmd.RevisionID)
	if err != nil {
		return nil, fmt.Errorf("copy revision items to working items: %w", err)
	}

	// 5. Update working copy metadata: base moves to the revision and the
	// authoring defaults RESTORE from the revision snapshot — a reset that
	// left current defaults in place would silently mix revision truth with
	// working intent (#784).
	actor := nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx))
	_, err = s.db(ctx).Exec(ctx, `
		INSERT INTO design_working_copies (design_id, organization_id, project_id, base_revision_id, source_type, authoring_defaults, updated_at, updated_by)
		VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
		ON CONFLICT (design_id) DO UPDATE SET
			base_revision_id = EXCLUDED.base_revision_id,
			source_type = EXCLUDED.source_type,
			authoring_defaults = EXCLUDED.authoring_defaults,
			updated_at = NOW(),
			updated_by = EXCLUDED.updated_by
	`, cmd.DesignID, designOrgID, projectID, cmd.RevisionID, revSourceType, revDefaultsJSON, actor)
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
	CustomerID                string
	CustomerName              string
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

// SetDesignWorkingCopyOpeningCommand is the #1137 surgical opening write: it
// touches ONLY the authoring defaults' opening selection — never the items
// (UpdateDesignWorkingCopy's item frontier deletes-and-reinserts, which a
// semantic selection write must never trigger).
type SetDesignWorkingCopyOpeningCommand struct {
	DesignID string
	// ExpectedWorkingVersion is the optimistic-concurrency token (the
	// working copy's updated_at). nil means no precondition.
	ExpectedWorkingVersion *time.Time
	Opening                *domain.DesignOpeningSelection
	ActorUserID            string
}

// SetDesignWorkingCopyOpening persists the design's opening intent with a
// read-modify-write of the authoring defaults block under the row lock,
// preserving every other field of the block (materialChoices included).
func (s *PostgresStore) SetDesignWorkingCopyOpening(ctx context.Context, cmd SetDesignWorkingCopyOpeningCommand) (*domain.DesignAuthoringDefaults, error) {
	if !isValidUUID(cmd.DesignID) {
		return nil, domain.ErrDesignNotFound
	}
	if transactionFromContext(ctx) == nil {
		var res *domain.DesignAuthoringDefaults
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			r, err := s.SetDesignWorkingCopyOpening(txCtx, cmd)
			if err != nil {
				return err
			}
			res = r
			return nil
		})
		return res, err
	}

	var defaultsJSON []byte
	var storedUpdatedAt time.Time
	err := s.db(ctx).QueryRow(ctx, `
		SELECT authoring_defaults, updated_at
		FROM design_working_copies
		WHERE design_id = $1 AND organization_id = $2
		FOR UPDATE
	`, cmd.DesignID, OrgFromCtx(ctx)).Scan(&defaultsJSON, &storedUpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrDesignNotFound
	}
	if err != nil {
		return nil, err
	}
	if cmd.ExpectedWorkingVersion != nil &&
		(cmd.ExpectedWorkingVersion.IsZero() || !cmd.ExpectedWorkingVersion.UTC().Equal(storedUpdatedAt.UTC())) {
		return nil, ErrWorkingCopyVersionConflict
	}

	var defaults domain.DesignAuthoringDefaults
	if err := json.Unmarshal(defaultsJSON, &defaults); err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrSerializationFailed, err)
	}
	defaults = defaults.Normalize()
	defaults.Opening = cmd.Opening
	if err := domain.ValidateDesignAuthoringDefaults(defaults); err != nil {
		return nil, err
	}
	updatedJSON, err := json.Marshal(defaults.Normalize())
	if err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrSerializationFailed, err)
	}
	if _, err := s.db(ctx).Exec(ctx, `
		UPDATE design_working_copies
		SET authoring_defaults = $1, updated_at = NOW(), updated_by = $2
		WHERE design_id = $3 AND organization_id = $4
	`, updatedJSON, cmd.ActorUserID, cmd.DesignID, OrgFromCtx(ctx)); err != nil {
		return nil, err
	}
	return &defaults, nil
}
