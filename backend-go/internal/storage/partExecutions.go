package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

/**
 * Physical production execution storage (OC-030..OC-034).
 *
 * Part instances and module units live as JSONB columns on the projects row
 * (migration 000069), same convention as cut_plan / approvals / change_orders.
 * Station scans are concurrent by nature, so every mutation runs inside one
 * transaction that locks the projects row (SELECT … FOR UPDATE) before
 * read-modify-write — two operators advancing different pieces of the same
 * project can never clobber each other (the floor-scan lesson, F089-RN).
 */

var ErrPartExecutionsNotFound = errors.New("project not found")

// loadPartExecutionsSnapshotTx loads part_instances/module_units plus the
// per-item legacy floor statuses with the project row already locked.
func (s *PostgresStore) loadPartExecutionsSnapshotTx(ctx context.Context, tx pgx.Tx, projectID string) (*domain.PartExecutionsSnapshot, error) {
	var partsRaw, unitsRaw, qualityRaw []byte
	err := tx.QueryRow(ctx, `
		SELECT part_instances, module_units, quality FROM projects WHERE id = $1 AND (organization_id = $2 OR sales_organization_id = $2 OR manufacturing_organization_id = $2) FOR UPDATE;
	`, projectID, OrgFromCtx(ctx)).Scan(&partsRaw, &unitsRaw, &qualityRaw)
	if err != nil {
		return nil, ErrPartExecutionsNotFound
	}

	snap := &domain.PartExecutionsSnapshot{ItemStatuses: map[string]string{}, ItemQuantities: map[string]int{}}
	if len(qualityRaw) > 0 && string(qualityRaw) != "null" {
		var job domain.QualityJob
		if err := json.Unmarshal(qualityRaw, &job); err == nil {
			snap.Quality = &job
		}
	}
	if len(partsRaw) > 0 && string(partsRaw) != "null" {
		if err := json.Unmarshal(partsRaw, &snap.Parts); err != nil {
			return nil, fmt.Errorf("error decoding part_instances: %w", err)
		}
	}
	if len(unitsRaw) > 0 && string(unitsRaw) != "null" {
		if err := json.Unmarshal(unitsRaw, &snap.Units); err != nil {
			return nil, fmt.Errorf("error decoding module_units: %w", err)
		}
	}

	rows, err := tx.Query(ctx, `
		SELECT id, COALESCE(floor_status, 'pending'), COALESCE(quantity, 1) FROM project_items WHERE project_id = $1;
	`, projectID)
	if err != nil {
		return nil, fmt.Errorf("error loading item floor statuses: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id, status string
		var quantity int
		if err := rows.Scan(&id, &status, &quantity); err != nil {
			return nil, fmt.Errorf("error scanning item floor status: %w", err)
		}
		snap.ItemStatuses[id] = domain.NormalizeItemFloorStatus(status)
		snap.ItemQuantities[id] = quantity
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating item floor statuses: %w", err)
	}
	return snap, nil
}

// MutateProjectPartExecutions loads part_instances/module_units plus the
// per-item legacy floor statuses with the project row locked, runs the
// mutator (pure domain logic), and persists everything atomically: JSONB
// payloads, derived legacy item statuses (OC-034 bridge) and audit floor
// events in the same transaction.
func (s *PostgresStore) MutateProjectPartExecutions(
	ctx context.Context,
	projectID string,
	mutate func(snap *domain.PartExecutionsSnapshot) (*domain.PartExecutionsMutation, error),
) (*domain.PartExecutionsMutation, error) {
	tx, err := s.beginTx(ctx)
	if err != nil {
		return nil, fmt.Errorf("error beginning part executions tx: %w", err)
	}
	defer tx.Rollback(ctx)

	snap, err := s.loadPartExecutionsSnapshotTx(ctx, tx, projectID)
	if err != nil {
		return nil, err
	}

	// Canonical execution membership belongs to the released revision, not
	// the editable quote or its current materialized links. Legacy projects
	// retain the project-item quantity compatibility contract above.
	authority, err := s.resolveProjectReleaseAuthorityTx(ctx, tx, projectID, nil)
	if err != nil {
		return nil, fmt.Errorf("error resolving execution release: %w", err)
	}
	if authority != nil {
		snap.ProductionRelease = authority
		// Shared guard for generation, advance, rework and supervisor
		// override: exact frozen P1/R2/fingerprint, then the frozen routing
		// evidence decides (schema v2 authorizes, v1 keeps failing closed).
		if err := s.guardCanonicalExecutionRouting(ctx, tx, projectID, authority); err != nil {
			return nil, err
		}
	}

	mutation, err := mutate(snap)
	if err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE projects
		SET part_instances = $2, module_units = $3,
		    quality = COALESCE($4, quality),
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND (organization_id = $5 OR sales_organization_id = $5 OR manufacturing_organization_id = $5);
	`, projectID, jsonbSliceArg(mutation.Parts), jsonbSliceArg(mutation.Units), jsonbStructArg(mutation.Quality), OrgFromCtx(ctx)); err != nil {
		return nil, fmt.Errorf("error persisting part executions: %w", err)
	}

	for itemID, status := range mutation.ItemStatuses {
		// Canonical keys are FurnitureInstance IDs, not quote-line IDs.
		if snap.ProductionRelease != nil {
			continue
		}
		if before, ok := snap.ItemStatuses[itemID]; ok && before == status {
			continue
		}
		if _, err := tx.Exec(ctx, `
			UPDATE project_items SET floor_status = $2 WHERE id = $1;
		`, itemID, status); err != nil {
			return nil, fmt.Errorf("error updating item floor status %s: %w", itemID, err)
		}
	}

	if err := upsertFloorEventsTx(ctx, tx, projectID, mutation.FloorEvents); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("error committing part executions tx: %w", err)
	}
	return mutation, nil
}

// GenerateCanonicalPartExecutions derives the physical executions of a
// canonical release EXCLUSIVELY from its frozen snapshot: the frozen BOM parts
// carry the physical truth and the frozen schema-v2 routing program the
// required operations (#577). Server authority under the project row lock —
// client payloads are never input. Fail-closed end to end: the exact frozen
// P1/revision/fingerprint pair and the routing evidence are validated by the
// shared guard before anything is derived or written; a schema-v1 release
// (no frozen routing) keeps rejecting. Replacing executions that already
// advanced requires the explicit supervisor force, same contract as legacy.
func (s *PostgresStore) GenerateCanonicalPartExecutions(
	ctx context.Context,
	projectID string,
	force bool,
) ([]domain.PartInstance, []domain.ModuleUnitExecution, error) {
	tx, err := s.beginTx(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("error beginning part executions tx: %w", err)
	}
	defer tx.Rollback(ctx)

	snap, err := s.loadPartExecutionsSnapshotTx(ctx, tx, projectID)
	if err != nil {
		return nil, nil, err
	}

	authority, err := s.resolveProjectReleaseAuthorityTx(ctx, tx, projectID, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("error resolving execution release: %w", err)
	}
	if authority == nil || authority.Source != domain.ProductionReleaseAuthorityCanonical {
		return nil, nil, errors.New("BAD_REQUEST:la obra no tiene una liberación canónica; use la generación legacy")
	}
	if err := s.guardCanonicalExecutionRouting(ctx, tx, projectID, authority); err != nil {
		return nil, nil, err
	}

	frozen, err := s.GetProductionReleaseManufacturingSnapshot(
		context.WithValue(ctx, transactionContextKey{}, tx), projectID, authority.ReleaseID)
	if err != nil {
		return nil, nil, err
	}
	if frozen.SchemaVersion < 2 || frozen.Routing == nil {
		return nil, nil, ErrReleaseRoutingUnavailable
	}
	unitViews := make([]engine.ReleaseExecutionUnitView, 0, len(frozen.Units))
	for _, unit := range frozen.Units {
		unitViews = append(unitViews, engine.ReleaseExecutionUnitView{
			FurnitureInstanceID: unit.Resolved.FurnitureInstanceID,
			Parts:               unit.Resolved.BOM.BoardParts,
		})
	}
	parts, units, err := engine.DeriveCanonicalPartExecutions(authority.ReleaseID, unitViews, frozen.Routing)
	if err != nil {
		return nil, nil, fmt.Errorf("CONFLICT:%s", domain.CanonicalPartExecutionRoutingBlocker)
	}
	for i := range parts {
		parts[i].ProjectID = projectID
	}
	for i := range units {
		units[i].ProjectID = projectID
	}

	hasProgress := false
	for _, existing := range snap.Parts {
		for _, op := range existing.RequiredOperations {
			if op.Status == domain.PartOperationStatusCompleted || op.Status == domain.PartOperationStatusInProgress || op.Status == domain.PartOperationStatusRework {
				hasProgress = true
			}
		}
	}
	for _, existing := range snap.Units {
		if existing.Status != domain.ModuleUnitStatusAwaitingParts {
			hasProgress = true
		}
	}
	if hasProgress && !force {
		return nil, nil, errors.New("CONFLICT:la obra ya tiene avance físico; regenerar requiere force=true (supervisión)")
	}

	if _, err := tx.Exec(ctx, `
		UPDATE projects
		SET part_instances = $2, module_units = $3,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND (organization_id = $4 OR sales_organization_id = $4 OR manufacturing_organization_id = $4);
	`, projectID, jsonbSliceArg(parts), jsonbSliceArg(units), OrgFromCtx(ctx)); err != nil {
		return nil, nil, fmt.Errorf("error persisting part executions: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("error committing part executions tx: %w", err)
	}
	return parts, units, nil
}
