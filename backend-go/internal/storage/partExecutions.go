package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/tiagofur/muebles-backend/internal/domain"
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
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("error beginning part executions tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var partsRaw, unitsRaw, qualityRaw []byte
	err = tx.QueryRow(ctx, `
		SELECT part_instances, module_units, quality FROM projects WHERE id = $1 FOR UPDATE;
	`, projectID).Scan(&partsRaw, &unitsRaw, &qualityRaw)
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

	mutation, err := mutate(snap)
	if err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE projects
		SET part_instances = $2, module_units = $3,
		    quality = COALESCE($4, quality),
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1;
	`, projectID, jsonbSliceArg(mutation.Parts), jsonbSliceArg(mutation.Units), jsonbStructArg(mutation.Quality)); err != nil {
		return nil, fmt.Errorf("error persisting part executions: %w", err)
	}

	for itemID, status := range mutation.ItemStatuses {
		if before, ok := snap.ItemStatuses[itemID]; ok && before == status {
			continue
		}
		if _, err := tx.Exec(ctx, `
			UPDATE project_items SET floor_status = $3 WHERE id = $1 AND project_id = $2;
		`, itemID, projectID, status); err != nil {
			return nil, fmt.Errorf("error persisting derived floor status for item %s: %w", itemID, err)
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
