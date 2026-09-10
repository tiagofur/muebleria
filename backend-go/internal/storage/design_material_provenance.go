package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// #637 / DT-MAT: quoted-material provenance detection and the explicit,
// narrowly-scoped reconciliation command for the mutable DesignWorkingCopy.
//
// Authority model (see docs/architecture/project-design-digital-thread.md):
//   - quoted choice  = the unit's current quote line option choices
//     (project_item_choices via quote_line_furniture_instances state='current'),
//     the same authority #621 exposes as FurnitureInstanceDisplay.material_choices;
//   - authored choice = design_working_items.material_choices — design truth,
//     published verbatim into immutable design_revision_items;
//   - historical revisions are NEVER touched here; after explicit
//     reconciliation a NEW revision may be published carrying the filled
//     choices while R1..Rn keep their original {} snapshots forever.

// DesignWorkingItemMaterialProvenance is the per-unit detection read model.
type DesignWorkingItemMaterialProvenance struct {
	FurnitureInstanceID   string
	FurnitureDefinitionID string
	// Roles carries one entry per role in the union of the working and quoted
	// choices, classified by the pure engine classifier.
	Roles []engine.MaterialRoleProvenance
	// Reconcilable is true when at least one role is a reconciliation
	// candidate (quoted, missing from the working copy, not alias-governed).
	Reconcilable bool
}

// DesignWorkingCopyMaterialProvenance is the detection read model for one
// exact Design working copy.
type DesignWorkingCopyMaterialProvenance struct {
	DesignID             string
	ProjectID            string
	WorkingCopyUpdatedAt time.Time
	Items                []DesignWorkingItemMaterialProvenance
}

// quotedOptionChoicesForInstance loads the board choices (option group code →
// material id) of the unit's current quote line. It returns nil when the unit
// carries no quoted finish.
func (s *PostgresStore) quotedOptionChoicesForInstance(ctx context.Context, furnitureInstanceID, projectID string) (map[string]string, error) {
	var optionsJSON []byte
	err := s.db(ctx).QueryRow(ctx, `
		SELECT quoted.option_choices
		FROM furniture_instances fi
		LEFT JOIN LATERAL (
			SELECT (SELECT jsonb_object_agg(pic.option_group_code, pic.choice_entity_id::text)
			        FROM project_item_choices pic
			        WHERE pic.project_item_id = pi.id) AS option_choices
			FROM quote_line_furniture_instances ql
			JOIN project_items pi ON pi.id = ql.quote_line_id
			WHERE ql.furniture_instance_id = $1
			  AND ql.project_id = $2
			  AND ql.state = 'current'
			ORDER BY ql.created_at DESC
			LIMIT 1
		) quoted ON TRUE
		WHERE fi.id = $1 AND fi.project_id = $2
	`, furnitureInstanceID, projectID).Scan(&optionsJSON)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: furniture instance %s", ErrFurnitureInstanceNotFound, furnitureInstanceID)
		}
		return nil, err
	}
	if len(optionsJSON) == 0 || string(optionsJSON) == "null" {
		return nil, nil
	}
	choices := map[string]string{}
	if err := json.Unmarshal(optionsJSON, &choices); err != nil {
		return nil, fmt.Errorf("%w: option_choices de la línea de cotización", domain.ErrInvalidRevisionSnapshot)
	}
	if len(choices) == 0 {
		return nil, nil
	}
	return choices, nil
}

// GetDesignWorkingCopyMaterialProvenance builds the detection read model for
// the exact design working copy. It is strictly READ-ONLY: no working copy is
// mutated, no repair is implied, published revisions are never read-modified.
func (s *PostgresStore) GetDesignWorkingCopyMaterialProvenance(ctx context.Context, designID string) (*DesignWorkingCopyMaterialProvenance, error) {
	if !isValidUUID(designID) {
		return nil, domain.ErrDesignNotFound
	}

	// Working-copy header under the design's project scope; a design invisible
	// to the tenant reads as not found (fail-closed, like GetDesignWorkingCopy).
	var projectID string
	var workingUpdatedAt time.Time
	err := s.db(ctx).QueryRow(ctx, `
		SELECT wc.project_id, wc.updated_at
		FROM design_working_copies wc
		JOIN designs d ON d.id = wc.design_id
		WHERE wc.design_id = $1
	`, designID).Scan(&projectID, &workingUpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Design with no working-copy row yet: honest empty read model.
			var orgID, projID string
			dErr := s.db(ctx).QueryRow(ctx, `SELECT organization_id, project_id FROM designs WHERE id = $1`, designID).Scan(&orgID, &projID)
			if dErr != nil {
				if errors.Is(dErr, pgx.ErrNoRows) {
					return nil, domain.ErrDesignNotFound
				}
				return nil, dErr
			}
			return &DesignWorkingCopyMaterialProvenance{
				DesignID:  designID,
				ProjectID: projID,
				Items:     []DesignWorkingItemMaterialProvenance{},
			}, nil
		}
		return nil, err
	}

	// One snapshot query joins every working item with its current quoted
	// choices (same LATERAL authority as #621's instance summaries). Only the
	// identity and material columns are needed by this read model.
	rows, err := s.db(ctx).Query(ctx, `
		SELECT dwi.furniture_instance_id::text,
		       COALESCE(dwi.furniture_definition_id::text, ''),
		       dwi.material_choices,
		       quoted.option_choices
		FROM design_working_items dwi
		LEFT JOIN LATERAL (
			SELECT (SELECT jsonb_object_agg(pic.option_group_code, pic.choice_entity_id::text)
			        FROM project_item_choices pic
			        WHERE pic.project_item_id = pi.id) AS option_choices
			FROM quote_line_furniture_instances ql
			JOIN project_items pi ON pi.id = ql.quote_line_id
			WHERE ql.furniture_instance_id = dwi.furniture_instance_id
			  AND ql.project_id = dwi.project_id
			  AND ql.state = 'current'
			ORDER BY ql.created_at DESC
			LIMIT 1
		) quoted ON TRUE
		WHERE dwi.design_id = $1
		ORDER BY dwi.created_at ASC, dwi.furniture_instance_id
	`, designID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := &DesignWorkingCopyMaterialProvenance{
		DesignID:             designID,
		ProjectID:            projectID,
		WorkingCopyUpdatedAt: workingUpdatedAt,
		Items:                []DesignWorkingItemMaterialProvenance{},
	}
	for rows.Next() {
		var instanceID, definitionID string
		var materialsJSON, optionsJSON []byte
		if err := rows.Scan(&instanceID, &definitionID, &materialsJSON, &optionsJSON); err != nil {
			return nil, err
		}
		working := map[string]string{}
		if len(materialsJSON) > 0 && string(materialsJSON) != "null" {
			if err := json.Unmarshal(materialsJSON, &working); err != nil {
				return nil, fmt.Errorf("%w: material_choices del working item", domain.ErrSerializationFailed)
			}
		}
		quoted := map[string]string{}
		if len(optionsJSON) > 0 && string(optionsJSON) != "null" {
			if err := json.Unmarshal(optionsJSON, &quoted); err != nil {
				return nil, fmt.Errorf("%w: option_choices de la línea de cotización", domain.ErrInvalidRevisionSnapshot)
			}
		}
		roles := engine.ClassifyMaterialRoleProvenance(working, quoted)
		entry := DesignWorkingItemMaterialProvenance{
			FurnitureInstanceID:   instanceID,
			FurnitureDefinitionID: definitionID,
			Roles:                 roles,
		}
		for _, role := range roles {
			if role.Provenance == engine.MaterialProvenanceQuotedMissingFromWorking {
				entry.Reconcilable = true
				break
			}
		}
		out.Items = append(out.Items, entry)
	}
	return out, rows.Err()
}

// ReconcileDesignWorkingMaterialsCommand targets ONE exact furniture instance
// of ONE exact design working copy. ExpectedUpdatedAt, when provided, is the
// optimistic-concurrency token the client read from the working copy
// (design_working_copies.updated_at, exposed by GET as updatedAt).
type ReconcileDesignWorkingMaterialsCommand struct {
	DesignID            string
	FurnitureInstanceID string
	ExpectedUpdatedAt   *time.Time
	ActorUserID         string
	IP                  string
	RequestID           string
}

// DesignWorkingMaterialsReconciliation reports what the explicit command did:
// the roles actually filled and the authored/alias-governed roles preserved
// verbatim. FilledChoices is empty on the idempotent no-op replay.
type DesignWorkingMaterialsReconciliation struct {
	DesignID             string
	ProjectID            string
	FurnitureInstanceID  string
	FilledChoices        map[string]string
	PreservedChoices     map[string]string
	WorkingCopyUpdatedAt time.Time
}

// ReconcileDesignWorkingMaterials applies the explicit, narrowly-scoped
// repair: it fills ONLY the quoted roles missing from the working item, never
// overwrites an authored role, never touches an alias-governed role, and
// never reads or mutates any published revision. The mutation reuses the
// canonical working-copy persistence (same tables, same design-row FOR UPDATE
// serialization as Update/ResetDesignWorkingCopy) inside one tenant
// transaction with a durable audit event — no second persistence model.
func (s *PostgresStore) ReconcileDesignWorkingMaterials(ctx context.Context, cmd ReconcileDesignWorkingMaterialsCommand) (*DesignWorkingMaterialsReconciliation, error) {
	if !isValidUUID(cmd.DesignID) {
		return nil, domain.ErrDesignNotFound
	}
	if !isValidUUID(cmd.FurnitureInstanceID) {
		return nil, fmt.Errorf("%w: invalid furniture_instance_id", domain.ErrInvalidDesignCommand)
	}

	if transactionFromContext(ctx) == nil {
		var res *DesignWorkingMaterialsReconciliation
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		actor.UserID = nonEmptyOrDefault(actor.UserID, cmd.ActorUserID)
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			r, err := s.ReconcileDesignWorkingMaterials(txCtx, cmd)
			if err != nil {
				return err
			}
			res = r
			return nil
		})
		return res, err
	}

	// 1. Lock the design row — the same serialization point the full working
	// copy PUT and reset use, so a concurrent SketchUp authoring save and this
	// repair cannot interleave.
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

	// 2. Optimistic concurrency on the working-copy state the caller read.
	// Postgres keeps microsecond precision; compare at that precision so a
	// client round-trip through RFC3339Nano never produces a false conflict.
	if cmd.ExpectedUpdatedAt != nil {
		var currentUpdatedAt time.Time
		err = s.db(ctx).QueryRow(ctx, `
			SELECT updated_at FROM design_working_copies WHERE design_id = $1
		`, cmd.DesignID).Scan(&currentUpdatedAt)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, domain.ErrWorkingCopyNotFound
			}
			return nil, err
		}
		if !currentUpdatedAt.Truncate(time.Microsecond).Equal(cmd.ExpectedUpdatedAt.Truncate(time.Microsecond)) {
			return nil, ErrVersionConflict
		}
	}

	// 3. The exact working item (design-scoped, instance-scoped).
	var rawMaterials []byte
	err = s.db(ctx).QueryRow(ctx, `
		SELECT material_choices
		FROM design_working_items
		WHERE design_id = $1 AND furniture_instance_id = $2
	`, cmd.DesignID, cmd.FurnitureInstanceID).Scan(&rawMaterials)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// The instance exists but is not part of this working copy, or it
			// belongs to another project. Both fail closed: never repair by
			// implication.
			var fiProjectID string
			fiErr := s.db(ctx).QueryRow(ctx, `
				SELECT project_id FROM furniture_instances WHERE id = $1
			`, cmd.FurnitureInstanceID).Scan(&fiProjectID)
			if fiErr != nil {
				if errors.Is(fiErr, pgx.ErrNoRows) {
					return nil, fmt.Errorf("%w: furniture instance %s", ErrFurnitureInstanceNotFound, cmd.FurnitureInstanceID)
				}
				return nil, fiErr
			}
			if fiProjectID != projectID {
				return nil, fmt.Errorf("%w: furniture instance %s", domain.ErrCrossProjectFurnitureInstance, cmd.FurnitureInstanceID)
			}
			return nil, domain.ErrWorkingItemNotFound
		}
		return nil, err
	}
	working := map[string]string{}
	if len(rawMaterials) > 0 && string(rawMaterials) != "null" {
		if err := json.Unmarshal(rawMaterials, &working); err != nil {
			return nil, fmt.Errorf("%w: material_choices del working item: %v", domain.ErrSerializationFailed, err)
		}
	}

	// 4. Quoted authority: the unit's current quote line choices. One
	// classification drives both the fill set and the preserved set.
	quoted, err := s.quotedOptionChoicesForInstance(ctx, cmd.FurnitureInstanceID, projectID)
	if err != nil {
		return nil, err
	}
	filled := map[string]string{}
	preserved := map[string]string{}
	for _, entry := range engine.ClassifyMaterialRoleProvenance(working, quoted) {
		switch entry.Provenance {
		case engine.MaterialProvenanceQuotedMissingFromWorking:
			filled[entry.Role] = entry.QuotedChoice
		case engine.MaterialProvenanceAuthored, engine.MaterialProvenanceInheritedDefault:
			preserved[entry.Role] = entry.EffectiveChoice
		}
	}

	if len(filled) == 0 {
		// Idempotent no-op: nothing mutated, no timestamp bump, no audit —
		// the honest "no reconciliation candidate" answer.
		var currentUpdatedAt time.Time
		if err := s.db(ctx).QueryRow(ctx, `
			SELECT updated_at FROM design_working_copies WHERE design_id = $1
		`, cmd.DesignID).Scan(&currentUpdatedAt); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, domain.ErrWorkingCopyNotFound
			}
			return nil, err
		}
		return &DesignWorkingMaterialsReconciliation{
			DesignID:             cmd.DesignID,
			ProjectID:            projectID,
			FurnitureInstanceID:  cmd.FurnitureInstanceID,
			FilledChoices:        filled,
			PreservedChoices:     preserved,
			WorkingCopyUpdatedAt: currentUpdatedAt,
		}, nil
	}

	// 5. Merge (fill-only) and persist through the canonical tables.
	merged := make(map[string]string, len(working)+len(filled))
	for role, choice := range working {
		merged[role] = choice
	}
	for role, choice := range filled {
		merged[role] = choice
	}
	mergedJSON, err := json.Marshal(merged)
	if err != nil {
		return nil, fmt.Errorf("%w: material_choices: %v", domain.ErrSerializationFailed, err)
	}
	if _, err := s.db(ctx).Exec(ctx, `
		UPDATE design_working_items
		SET material_choices = $1, updated_at = NOW()
		WHERE design_id = $2 AND furniture_instance_id = $3
	`, mergedJSON, cmd.DesignID, cmd.FurnitureInstanceID); err != nil {
		return nil, fmt.Errorf("reconcile working item materials: %w", err)
	}

	actor := nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx))
	var newUpdatedAt time.Time
	if err := s.db(ctx).QueryRow(ctx, `
		UPDATE design_working_copies
		SET updated_at = NOW(), updated_by = $2
		WHERE design_id = $1
		RETURNING updated_at
	`, cmd.DesignID, actor).Scan(&newUpdatedAt); err != nil {
		return nil, fmt.Errorf("bump working copy on material reconcile: %w", err)
	}

	// 6. Durable audit in the SAME transaction: the repair is explicit and
	// observable (which roles were filled from the quote, by whom).
	filledForAudit := map[string]interface{}{}
	for role, choice := range filled {
		filledForAudit[role] = choice
	}
	if err := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
		EventType:      "design_working_copy_materials_reconciled",
		ActorUserID:    actor,
		OrganizationID: designOrgID,
		IP:             cmd.IP,
		RequestID:      cmd.RequestID,
		Details: map[string]interface{}{
			"design_id":               cmd.DesignID,
			"project_id":              projectID,
			"furniture_instance_id":   cmd.FurnitureInstanceID,
			"filled_material_choices": filledForAudit,
		},
	}); err != nil {
		return nil, fmt.Errorf("audit design_working_copy_materials_reconciled: %w", err)
	}

	return &DesignWorkingMaterialsReconciliation{
		DesignID:             cmd.DesignID,
		ProjectID:            projectID,
		FurnitureInstanceID:  cmd.FurnitureInstanceID,
		FilledChoices:        filled,
		PreservedChoices:     preserved,
		WorkingCopyUpdatedAt: newUpdatedAt,
	}, nil
}
