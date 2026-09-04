package storage

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #393 / DT-9: QuoteRevision ↔ DesignRevision reconciliation by FurnitureInstance
// (ADR-0003, digital-thread §§15–16, 25, 26, 28, 30–31).
//
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

	// 3. Verify QuoteRevision. In current compatibility mode, verify that quoteRevisionID
	// does not belong to another project.
	var otherProjectID string
	err = s.db(ctx).QueryRow(ctx, `
		SELECT id FROM projects WHERE id = $1 AND id != $2
	`, quoteRevisionID, projectID).Scan(&otherProjectID)
	if err == nil {
		return nil, domain.ErrCrossProjectReconciliation
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	err = s.db(ctx).QueryRow(ctx, `
		SELECT project_id FROM quote_snapshots WHERE id = $1 AND project_id != $2
	`, quoteRevisionID, projectID).Scan(&otherProjectID)
	if err == nil {
		return nil, domain.ErrCrossProjectReconciliation
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	err = s.db(ctx).QueryRow(ctx, `
		SELECT project_id FROM designs WHERE source_quote_revision_id = $1 AND project_id != $2
	`, quoteRevisionID, projectID).Scan(&otherProjectID)
	if err == nil {
		return nil, domain.ErrCrossProjectReconciliation
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	// 4. Load Commercial Items Snapshot from quote_line_furniture_instances
	commercialItems := []domain.CommercialItemSnapshot{}
	commercialItemsByID := make(map[string]domain.CommercialItemSnapshot)

	rows, err := s.db(ctx).Query(ctx, `
		SELECT
			fi.id,
			COALESCE(fi.furniture_definition_id::text, ''),
			fi.lifecycle_status,
			COALESCE(pi.module_id::text, ''),
			pi.custom_dims,
			COALESCE(m.width_mm, 0),
			COALESCE(m.height_mm, 0),
			COALESCE(m.depth_mm, 0)
		FROM quote_line_furniture_instances ql
		JOIN furniture_instances fi ON fi.id = ql.furniture_instance_id
		JOIN project_items pi ON pi.id = ql.quote_line_id
		LEFT JOIN modules m ON m.id = COALESCE(fi.furniture_definition_id, pi.module_id)
		WHERE ql.project_id = $1
		  AND ql.state = 'current'
		ORDER BY fi.created_at, fi.id
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var fiID, fiDefID, fiLifecycle, piModuleID string
		var customDimsJSON []byte
		var mW, mH, mD int
		if err := rows.Scan(&fiID, &fiDefID, &fiLifecycle, &piModuleID, &customDimsJSON, &mW, &mH, &mD); err != nil {
			return nil, err
		}

		defID := fiDefID
		if defID == "" {
			defID = piModuleID
		}

		params := make(map[string]any)
		if len(customDimsJSON) > 0 && string(customDimsJSON) != "null" {
			var dims map[string]any
			if err := json.Unmarshal(customDimsJSON, &dims); err == nil {
				for k, v := range dims {
					params[k] = v
				}
			}
		}
		// Fallback to module defaults for widthMm, heightMm, depthMm if not set
		if _, ok := params["widthMm"]; !ok && mW > 0 {
			params["widthMm"] = mW
		}
		if _, ok := params["heightMm"]; !ok && mH > 0 {
			params["heightMm"] = mH
		}
		if _, ok := params["depthMm"]; !ok && mD > 0 {
			params["depthMm"] = mD
		}

		item := domain.CommercialItemSnapshot{
			FurnitureInstanceID:   fiID,
			FurnitureDefinitionID: defID,
			Parameters:            params,
			MaterialChoices:       make(map[string]string),
			LifecycleStatus:       fiLifecycle,
		}
		commercialItemsByID[fiID] = item
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Load material choices for the linked quote lines
	matRows, err := s.db(ctx).Query(ctx, `
		SELECT
			ql.furniture_instance_id,
			pic.option_group_code,
			pic.choice_entity_id::text
		FROM quote_line_furniture_instances ql
		JOIN project_item_choices pic ON pic.project_item_id = ql.quote_line_id
		WHERE ql.project_id = $1
		  AND ql.state = 'current'
	`, projectID)
	if err == nil {
		defer matRows.Close()
		for matRows.Next() {
			var fiID, groupCode, choiceID string
			if err := matRows.Scan(&fiID, &groupCode, &choiceID); err == nil {
				if item, ok := commercialItemsByID[fiID]; ok {
					item.MaterialChoices[groupCode] = choiceID
					commercialItemsByID[fiID] = item
				}
			}
		}
	}

	// Also load terminal furniture instances (removed or cancelled) for this project
	termRows, err := s.db(ctx).Query(ctx, `
		SELECT id, COALESCE(furniture_definition_id::text, ''), lifecycle_status
		FROM furniture_instances
		WHERE project_id = $1
		  AND lifecycle_status IN ('removed', 'cancelled')
		ORDER BY created_at, id
	`, projectID)
	if err == nil {
		defer termRows.Close()
		for termRows.Next() {
			var fiID, defID, status string
			if err := termRows.Scan(&fiID, &defID, &status); err == nil {
				if item, ok := commercialItemsByID[fiID]; ok {
					item.LifecycleStatus = status
					commercialItemsByID[fiID] = item
				} else {
					commercialItemsByID[fiID] = domain.CommercialItemSnapshot{
						FurnitureInstanceID:   fiID,
						FurnitureDefinitionID: defID,
						Parameters:            make(map[string]any),
						MaterialChoices:       make(map[string]string),
						LifecycleStatus:       status,
					}
				}
			}
		}
	}

	for _, item := range commercialItemsByID {
		commercialItems = append(commercialItems, item)
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
			_ = json.Unmarshal(paramsJSON, &item.Parameters)
		}
		item.MaterialChoices = make(map[string]string)
		if len(matJSON) > 0 && string(matJSON) != "null" {
			_ = json.Unmarshal(matJSON, &item.MaterialChoices)
		}
		if len(transformJSON) > 0 && string(transformJSON) != "null" {
			var tf domain.Transform3D
			if err := json.Unmarshal(transformJSON, &tf); err == nil {
				item.Transform = &tf
			}
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
