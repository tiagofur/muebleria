package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// querier is the shared query surface of pgxpool.Pool and pgx.Tx.
type querier interface {
	Query(ctx context.Context, sql string, args ...interface{}) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row
}

/**
 * Job costing storage (OC-080..OC-084, #304).
 *
 * The costing subprocess lives as a JSONB column on the projects row
 * (migration 000074) and is only mutated through this transactional entry
 * point (SELECT … FOR UPDATE + events in the same tx). The snapshot loads the
 * baseline sources (quote snapshot + production release), the quality job
 * (rework costs) and the job-assigned material consumption already valued per
 * material: stock movements assigned to the obra, the latest received-PO unit
 * cost per material and the catalog unit costs as fallback (OC-082).
 */

var ErrJobCostingProjectNotFound = errors.New("project not found")

// MutateProjectCosting loads the costing plus its context with the project row
// locked, runs the mutator, and persists the new costing and the audit events
// in one transaction. A nil mutation.Costing keeps the stored one (read path).
func (s *PostgresStore) MutateProjectCosting(
	ctx context.Context,
	projectID string,
	mutate func(snap *domain.JobCostingSnapshot) (*domain.JobCostingMutation, error),
) (*domain.JobCostingMutation, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("error beginning job costing tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var costingRaw, productionReleaseRaw, qualityRaw []byte
	err = tx.QueryRow(ctx, `
		SELECT costing, production_release, quality
		FROM projects WHERE id = $1 FOR UPDATE;
	`, projectID).Scan(&costingRaw, &productionReleaseRaw, &qualityRaw)
	if err != nil {
		return nil, ErrJobCostingProjectNotFound
	}

	snap := &domain.JobCostingSnapshot{}
	if len(costingRaw) > 0 && string(costingRaw) != "null" {
		var costing domain.JobCosting
		if err := json.Unmarshal(costingRaw, &costing); err != nil {
			return nil, fmt.Errorf("error decoding costing: %w", err)
		}
		snap.Costing = &costing
	}
	if len(productionReleaseRaw) > 0 && string(productionReleaseRaw) != "null" {
		var release domain.ProductionRelease
		if err := json.Unmarshal(productionReleaseRaw, &release); err == nil {
			snap.ProductionRelease = &release
		}
	}
	if len(qualityRaw) > 0 && string(qualityRaw) != "null" {
		var job domain.QualityJob
		if err := json.Unmarshal(qualityRaw, &job); err == nil {
			snap.Quality = &job
		}
	}

	snap.PriceSnapshot, err = loadQuoteSnapshotTx(ctx, tx, projectID)
	if err != nil {
		return nil, err
	}

	snap.Consumption, err = loadJobConsumptionTx(ctx, tx, projectID)
	if err != nil {
		return nil, err
	}

	mutation, err := mutate(snap)
	if err != nil {
		return nil, err
	}

	if mutation.Costing != nil {
		if _, err := tx.Exec(ctx, `
			UPDATE projects
			SET costing = $2,
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = $1;
		`, projectID, jsonbStructArg(mutation.Costing)); err != nil {
			return nil, fmt.Errorf("error persisting costing: %w", err)
		}
	}

	if err := upsertProjectEventsTx(ctx, tx, projectID, mutation.Events); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("error committing job costing tx: %w", err)
	}
	return mutation, nil
}

// loadQuoteSnapshotTx reads the frozen quote snapshot of the project (the
// revenue/estimated source of the baseline, OC-080).
func loadQuoteSnapshotTx(ctx context.Context, tx querier, projectID string) (*domain.QuotePriceSnapshot, error) {
	var snapshot domain.QuotePriceSnapshot
	err := tx.QueryRow(ctx, `
		SELECT captured_at, materials_cost, edge_total, hardware_total, direct_cost, labor_modular, labor_fixed_cost, margin_factor, sale_price
		FROM quote_snapshots
		WHERE project_id = $1;
	`, projectID).Scan(
		&snapshot.CapturedAt,
		&snapshot.Breakdown.MaterialsCost,
		&snapshot.Breakdown.EdgeTotal,
		&snapshot.Breakdown.HardwareTotal,
		&snapshot.Breakdown.DirectCost,
		&snapshot.Breakdown.LaborModular,
		&snapshot.Breakdown.LaborFixedCost,
		&snapshot.Breakdown.MarginFactor,
		&snapshot.Breakdown.SalePrice,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil // sin snapshot todavía — el baseline lo exige y explica
		}
		return nil, fmt.Errorf("error loading quote snapshot: %w", err)
	}

	pricesRows, err := tx.Query(ctx, `
		SELECT entity_type, entity_id, cost_value
		FROM snapshot_prices
		WHERE snapshot_id = (SELECT id FROM quote_snapshots WHERE project_id = $1);
	`, projectID)
	if err != nil {
		return &snapshot, nil
	}
	defer pricesRows.Close()
	snapshot.MaterialCostPerM2 = map[string]float64{}
	snapshot.EdgeCostPerMl = map[string]float64{}
	snapshot.HardwareCostPerUnit = map[string]float64{}
	for pricesRows.Next() {
		var entityType, entityID string
		var value float64
		if err := pricesRows.Scan(&entityType, &entityID, &value); err != nil {
			continue
		}
		switch entityType {
		case "material":
			snapshot.MaterialCostPerM2[entityID] = value
		case "edge":
			snapshot.EdgeCostPerMl[entityID] = value
		case "hardware":
			snapshot.HardwareCostPerUnit[entityID] = value
		}
	}
	return &snapshot, nil
}

// loadJobConsumptionTx aggregates the material consumption assigned to the
// obra (OC-082): salida/despacho stock movements carrying the project id,
// valued with the latest received-PO unit cost per material (real price paid)
// and the catalog unit cost as proxy fallback. Units are the material's stock
// unit on all three sources.
func loadJobConsumptionTx(ctx context.Context, tx querier, projectID string) ([]domain.MaterialConsumptionInput, error) {
	rows, err := tx.Query(ctx, `
		SELECT kind, material_id, SUM(-delta) AS consumed
		FROM stock_movements
		WHERE project_id = $1 AND delta < 0
		GROUP BY kind, material_id
		ORDER BY kind, material_id;
	`, projectID)
	if err != nil {
		return nil, fmt.Errorf("error loading job consumption: %w", err)
	}
	defer rows.Close()

	type consumed struct {
		kind       string
		materialID string
		quantity   float64
	}
	var list []consumed
	for rows.Next() {
		var c consumed
		if err := rows.Scan(&c.kind, &c.materialID, &c.quantity); err != nil {
			return nil, fmt.Errorf("error scanning job consumption: %w", err)
		}
		if c.quantity > 0 {
			list = append(list, c)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating job consumption: %w", err)
	}
	if len(list) == 0 {
		return nil, nil
	}

	poCosts, err := loadLatestReceivedPOUnitCostsTx(ctx, tx)
	if err != nil {
		return nil, err
	}
	catalogCosts, err := loadCatalogUnitCostsTx(ctx, tx)
	if err != nil {
		return nil, err
	}

	inputs := make([]domain.MaterialConsumptionInput, 0, len(list))
	for _, c := range list {
		input := domain.MaterialConsumptionInput{MaterialID: c.materialID, Quantity: c.quantity}
		if unitCost, ok := poCosts[c.materialID]; ok {
			v := unitCost
			input.POUnitCost = &v
		}
		if unitCost, ok := catalogCosts[c.kind+":"+c.materialID]; ok {
			v := unitCost
			input.CatalogUnitCost = &v
		}
		inputs = append(inputs, input)
	}
	return inputs, nil
}

// loadLatestReceivedPOUnitCostsTx returns, per material, the unit cost of the
// most recent PO that actually received it — the real price paid (OC-053
// snapshot, used here for job costing).
func loadLatestReceivedPOUnitCostsTx(ctx context.Context, tx querier) (map[string]float64, error) {
	rows, err := tx.Query(ctx, `
		SELECT DISTINCT ON (poi.material_id)
			poi.material_id, poi.unit_cost
		FROM purchase_order_items poi
		JOIN purchase_orders po ON po.id = poi.po_id
		WHERE poi.unit_cost IS NOT NULL
		  AND poi.received_quantity > 0
		  AND po.status <> 'cancelada'
		ORDER BY poi.material_id, po.received_at DESC NULLS LAST, po.created_at DESC;
	`)
	if err != nil {
		return nil, fmt.Errorf("error loading PO unit costs: %w", err)
	}
	defer rows.Close()
	costs := map[string]float64{}
	for rows.Next() {
		var materialID string
		var unitCost *float64
		if err := rows.Scan(&materialID, &unitCost); err != nil {
			return nil, fmt.Errorf("error scanning PO unit cost: %w", err)
		}
		if unitCost != nil {
			costs[materialID] = *unitCost
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating PO unit costs: %w", err)
	}
	return costs, nil
}

// loadCatalogUnitCostsTx returns the current catalog unit cost per stock
// material kind:id (tableros→cost_per_m2, cintillas→cost_per_ml,
// herrajes→cost_per_unit) — the proxy valuation fallback (OC-082).
func loadCatalogUnitCostsTx(ctx context.Context, tx querier) (map[string]float64, error) {
	costs := map[string]float64{}
	boardRows, err := tx.Query(ctx, `SELECT id, cost_per_m2 FROM material_boards;`)
	if err != nil {
		return nil, fmt.Errorf("error loading board costs: %w", err)
	}
	for boardRows.Next() {
		var id string
		var cost float64
		if err := boardRows.Scan(&id, &cost); err == nil {
			costs["tableros:"+id] = cost
		}
	}
	boardRows.Close()

	edgeRows, err := tx.Query(ctx, `SELECT id, cost_per_ml FROM edge_bands;`)
	if err != nil {
		return nil, fmt.Errorf("error loading edge costs: %w", err)
	}
	for edgeRows.Next() {
		var id string
		var cost float64
		if err := edgeRows.Scan(&id, &cost); err == nil {
			costs["cintillas:"+id] = cost
		}
	}
	edgeRows.Close()

	hardwareRows, err := tx.Query(ctx, `SELECT id, cost_per_unit FROM hardwares;`)
	if err != nil {
		return nil, fmt.Errorf("error loading hardware costs: %w", err)
	}
	for hardwareRows.Next() {
		var id string
		var cost float64
		if err := hardwareRows.Scan(&id, &cost); err == nil {
			costs["herrajes:"+id] = cost
		}
	}
	hardwareRows.Close()
	return costs, nil
}
