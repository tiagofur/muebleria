package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

/**
 * Installation job storage (OC-070..OC-074).
 *
 * The installation job lives as a JSONB column on the projects row (migration
 * 000070) and is only mutated through this transactional entry point: the
 * project row is locked (SELECT … FOR UPDATE) before read-modify-write, so a
 * visit update and a closeout sign-off on the same project can never clobber
 * each other. The closeout gates (OC-074) are evaluated against the locked
 * state, and the audit lifecycle events are appended in the same transaction.
 */

var ErrInstallationProjectNotFound = errors.New("project not found")

// MutateProjectInstallation loads the installation job plus the state the
// closeout gates depend on (physical units, legacy item statuses, lifecycle
// event flags) with the project row locked, runs the mutator, and persists the
// new job and the audit events in one transaction.
func (s *PostgresStore) MutateProjectInstallation(
	ctx context.Context,
	projectID string,
	mutate func(snap *domain.InstallationSnapshot) (*domain.InstallationMutation, error),
) (*domain.InstallationMutation, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("error beginning installation tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var installationRaw, unitsRaw []byte
	err = tx.QueryRow(ctx, `
		SELECT installation, module_units FROM projects WHERE id = $1 FOR UPDATE;
	`, projectID).Scan(&installationRaw, &unitsRaw)
	if err != nil {
		return nil, ErrInstallationProjectNotFound
	}

	snap := &domain.InstallationSnapshot{}
	if len(installationRaw) > 0 && string(installationRaw) != "null" {
		var job domain.InstallationJob
		if err := json.Unmarshal(installationRaw, &job); err != nil {
			return nil, fmt.Errorf("error decoding installation: %w", err)
		}
		snap.Job = &job
	}
	if len(unitsRaw) > 0 && string(unitsRaw) != "null" {
		if err := json.Unmarshal(unitsRaw, &snap.Units); err != nil {
			return nil, fmt.Errorf("error decoding module_units: %w", err)
		}
	}

	rows, err := tx.Query(ctx, `
		SELECT id, COALESCE(floor_status, 'pending')
		FROM project_items WHERE project_id = $1;
	`, projectID)
	if err != nil {
		return nil, fmt.Errorf("error loading items for installation gates: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var item domain.ProjectItem
		var floorStatus string
		if err := rows.Scan(&item.ID, &floorStatus); err != nil {
			return nil, fmt.Errorf("error scanning item for installation gates: %w", err)
		}
		item.FloorStatus = domain.NormalizeItemFloorStatus(floorStatus)
		snap.Items = append(snap.Items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating items for installation gates: %w", err)
	}

	err = tx.QueryRow(ctx, `
		SELECT
			EXISTS(SELECT 1 FROM project_events WHERE project_id = $1 AND type = 'installation_started'),
			EXISTS(SELECT 1 FROM project_events WHERE project_id = $1 AND type = 'installation_completed');
	`, projectID).Scan(&snap.HasInstallationStartedEvent, &snap.HasInstallationCompletedEvent)
	if err != nil {
		return nil, fmt.Errorf("error loading installation event flags: %w", err)
	}

	mutation, err := mutate(snap)
	if err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE projects
		SET installation = $2, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1;
	`, projectID, jsonbStructArg(mutation.Job)); err != nil {
		return nil, fmt.Errorf("error persisting installation: %w", err)
	}

	if err := upsertProjectEventsTx(ctx, tx, projectID, mutation.Events); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("error committing installation tx: %w", err)
	}
	return mutation, nil
}
