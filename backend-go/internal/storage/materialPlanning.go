package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

/**
 * Material planning storage (OC-050..OC-054).
 *
 * The planning lives as a JSONB column on the projects row (migration 000071)
 * and is only mutated through this transactional entry point. The project row
 * is locked (SELECT … FOR UPDATE) and the snapshot loads the warehouse
 * context the reserve caps and the release gates depend on: every project's
 * planning, the stock balances and the emitted purchase orders (incoming).
 */

var ErrMaterialPlanningProjectNotFound = errors.New("project not found")

// MutateProjectMaterialPlanning loads the planning plus its warehouse context
// with the project row locked, runs the mutator, and persists the new
// planning, an optional materials_release stamp and the audit events in one
// transaction.
func (s *PostgresStore) MutateProjectMaterialPlanning(
	ctx context.Context,
	projectID string,
	mutate func(snap *domain.MaterialPlanningSnapshot) (*domain.MaterialPlanningMutation, error),
) (*domain.MaterialPlanningMutation, error) {
	tx, err := s.beginTx(ctx)
	if err != nil {
		return nil, fmt.Errorf("error beginning material planning tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var planningRaw, productionReleaseRaw, materialsReleaseRaw []byte
	err = tx.QueryRow(ctx, `
		SELECT material_planning, production_release, materials_release
		FROM projects WHERE id = $1 AND (organization_id = $2 OR sales_organization_id = $2 OR manufacturing_organization_id = $2) FOR UPDATE;
	`, projectID, OrgFromCtx(ctx)).Scan(&planningRaw, &productionReleaseRaw, &materialsReleaseRaw)
	if err != nil {
		return nil, ErrMaterialPlanningProjectNotFound
	}

	snap := &domain.MaterialPlanningSnapshot{}
	if len(planningRaw) > 0 && string(planningRaw) != "null" {
		var planning domain.MaterialPlanning
		if err := json.Unmarshal(planningRaw, &planning); err != nil {
			return nil, fmt.Errorf("error decoding material_planning: %w", err)
		}
		snap.Planning = &planning
	}
	if len(productionReleaseRaw) > 0 && string(productionReleaseRaw) != "null" {
		var release domain.ProductionRelease
		if err := json.Unmarshal(productionReleaseRaw, &release); err == nil {
			snap.ProductionRelease = &release
		}
	}
	snap.MaterialsReleased = len(materialsReleaseRaw) > 0 && string(materialsReleaseRaw) != "null"

	// Every project's planning — availability/reservations are warehouse-wide.
	planningRows, err := tx.Query(ctx, `
		SELECT material_planning FROM projects
		WHERE material_planning IS NOT NULL AND material_planning::text <> 'null' AND organization_id = $1;
	`, OrgFromCtx(ctx))
	if err != nil {
		return nil, fmt.Errorf("error loading plannings: %w", err)
	}
	defer planningRows.Close()
	for planningRows.Next() {
		var raw []byte
		if err := planningRows.Scan(&raw); err != nil {
			return nil, fmt.Errorf("error scanning planning: %w", err)
		}
		var planning domain.MaterialPlanning
		if err := json.Unmarshal(raw, &planning); err != nil {
			continue
		}
		snap.AllPlannings = append(snap.AllPlannings, &planning)
	}
	if err := planningRows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating plannings: %w", err)
	}

	// Stock balances for the availability math.
	stockRows, err := tx.Query(ctx, `
		SELECT kind, material_id, quantity, min_stock FROM material_stock WHERE organization_id = $1;
	`, OrgFromCtx(ctx))
	if err != nil {
		return nil, fmt.Errorf("error loading stock for planning: %w", err)
	}
	defer stockRows.Close()
	for stockRows.Next() {
		var s domain.MaterialStock
		if err := stockRows.Scan(&s.Kind, &s.MaterialID, &s.Quantity, &s.MinStock); err != nil {
			return nil, fmt.Errorf("error scanning stock for planning: %w", err)
		}
		snap.Stock = append(snap.Stock, s)
	}
	if err := stockRows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating stock for planning: %w", err)
	}

	poRows, err := tx.Query(ctx, `
		SELECT ` + poColumns + ` FROM purchase_orders WHERE organization_id = $1;
	`, OrgFromCtx(ctx))
	if err != nil {
		return nil, fmt.Errorf("error loading purchase orders for planning: %w", err)
	}
	defer poRows.Close()
	poHeaders := map[string]*domain.PurchaseOrder{}
	var poOrder []string
	for poRows.Next() {
		po, err := scanPurchaseOrderRow(poRows)
		if err != nil {
			return nil, fmt.Errorf("error scanning purchase order for planning: %w", err)
		}
		snap.PurchaseOrders = append(snap.PurchaseOrders, po)
		poHeaders[po.ID] = &snap.PurchaseOrders[len(snap.PurchaseOrders)-1]
		poOrder = append(poOrder, po.ID)
	}
	if err := poRows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating purchase orders for planning: %w", err)
	}
	if len(poOrder) > 0 {
		itemRows, err := tx.Query(ctx, `
			SELECT po_id, kind, material_id, quantity, received_quantity, unit_cost, allocated_project_id::text
			FROM purchase_order_items WHERE po_id = ANY($1)
			ORDER BY po_id, kind, material_id;
		`, poOrder)
		if err != nil {
			return nil, fmt.Errorf("error loading PO items for planning: %w", err)
		}
		defer itemRows.Close()
		for itemRows.Next() {
			var poID string
			var it domain.PurchaseOrderItem
			if err := itemRows.Scan(&poID, &it.Kind, &it.MaterialID, &it.Quantity, &it.ReceivedQuantity, &it.UnitCost, &it.AllocatedProjectID); err != nil {
				return nil, fmt.Errorf("error scanning PO item for planning: %w", err)
			}
			if po := poHeaders[poID]; po != nil {
				po.Items = append(po.Items, it)
			}
		}
		if err := itemRows.Err(); err != nil {
			return nil, fmt.Errorf("error iterating PO items for planning: %w", err)
		}
	}

	err = tx.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM project_events WHERE project_id = $1 AND type = 'materials_reserved');
	`, projectID).Scan(&snap.HasMaterialsReservedEvent)
	if err != nil {
		return nil, fmt.Errorf("error loading materials event flags: %w", err)
	}

	mutation, err := mutate(snap)
	if err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE projects
		SET material_planning = $2,
		    materials_release = COALESCE($3, materials_release),
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND (organization_id = $4 OR sales_organization_id = $4 OR manufacturing_organization_id = $4);
	`, projectID, jsonbStructArg(mutation.Planning), jsonbStructArg(mutation.MaterialsRelease), OrgFromCtx(ctx)); err != nil {
		return nil, fmt.Errorf("error persisting material planning: %w", err)
	}

	if err := upsertProjectEventsTx(ctx, tx, projectID, mutation.Events); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("error committing material planning tx: %w", err)
	}
	return mutation, nil
}
