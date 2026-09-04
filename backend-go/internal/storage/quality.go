package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

/**
 * Quality job storage (OC-060..OC-062).
 *
 * The quality job lives as a JSONB column on the projects row (migration
 * 000072). Rework actions may also reopen/scrap physical pieces, so the
 * mutation loads quality + part_instances + module_units with the project row
 * locked and persists everything atomically: the job, the affected pieces,
 * the derived legacy item statuses (OC-034 bridge), floor events and the
 * lifecycle audit events.
 */

var ErrQualityProjectNotFound = errors.New("project not found")

// MutateProjectQuality loads the quality job plus the physical executions a
// rework action may touch, runs the mutator and persists everything atomically.
func (s *PostgresStore) MutateProjectQuality(
	ctx context.Context,
	projectID string,
	mutate func(snap *domain.QualitySnapshot) (*domain.QualityMutation, error),
) (*domain.QualityMutation, error) {
	tx, err := s.beginTx(ctx)
	if err != nil {
		return nil, fmt.Errorf("error beginning quality tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var qualityRaw, partsRaw, unitsRaw, releaseRaw []byte
	err = tx.QueryRow(ctx, `
		SELECT quality, part_instances, module_units, production_release
		FROM projects WHERE id = $1 AND (organization_id = $2 OR sales_organization_id = $2 OR manufacturing_organization_id = $2) FOR UPDATE;
	`, projectID, OrgFromCtx(ctx)).Scan(&qualityRaw, &partsRaw, &unitsRaw, &releaseRaw)
	if err != nil {
		return nil, ErrQualityProjectNotFound
	}

	snap := &domain.QualitySnapshot{ItemStatuses: map[string]string{}, ItemQuantities: map[string]int{}}
	if len(qualityRaw) > 0 && string(qualityRaw) != "null" {
		var job domain.QualityJob
		if err := json.Unmarshal(qualityRaw, &job); err != nil {
			return nil, fmt.Errorf("error decoding quality: %w", err)
		}
		snap.Quality = &job
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
	if len(releaseRaw) > 0 && string(releaseRaw) != "null" {
		var release domain.LegacyProductionRelease
		if err := json.Unmarshal(releaseRaw, &release); err == nil && release.ID != "" {
			snap.ReleasedRevision = release.ID
		}
	}
	// #395: ONE release authority — the canonical ProductionRelease wins over
	// the legacy blob for every production consumer.
	authority, err := s.resolveProjectReleaseAuthorityTx(ctx, tx, projectID, &domain.LegacyProductionRelease{ID: snap.ReleasedRevision})
	if err != nil {
		return nil, fmt.Errorf("error resolving release authority: %w", err)
	}
	if authority != nil {
		snap.ReleasedRevision = authority.ReleaseID
	}

	rows, err := tx.Query(ctx, `
		SELECT id, COALESCE(floor_status, 'pending'), COALESCE(quantity, 1) FROM project_items WHERE project_id = $1;
	`, projectID)
	if err != nil {
		return nil, fmt.Errorf("error loading item floor statuses for quality: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id, status string
		var quantity int
		if err := rows.Scan(&id, &status, &quantity); err != nil {
			return nil, fmt.Errorf("error scanning item for quality: %w", err)
		}
		snap.ItemStatuses[id] = domain.NormalizeItemFloorStatus(status)
		snap.ItemQuantities[id] = quantity
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating items for quality: %w", err)
	}

	mutation, err := mutate(snap)
	if err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE projects
		SET quality = $2, part_instances = $3, module_units = $4, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND (organization_id = $5 OR sales_organization_id = $5 OR manufacturing_organization_id = $5);
	`, projectID, jsonbStructArg(mutation.Quality), jsonbSliceArg(mutation.Parts), jsonbSliceArg(mutation.Units), OrgFromCtx(ctx)); err != nil {
		return nil, fmt.Errorf("error persisting quality: %w", err)
	}

	for itemID, status := range mutation.ItemStatuses {
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

	if err := upsertProjectEventsTx(ctx, tx, projectID, mutation.Events); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("error committing quality tx: %w", err)
	}
	return mutation, nil
}
