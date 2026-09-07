package storage

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ListMachineOutputSelections returns the org's selections (empty when none
// configured — absence is NO_OUTPUT_CONFIGURED, never a silent default).
func (s *PostgresStore) ListMachineOutputSelections(ctx context.Context) ([]domain.MachineOutputSelectionRecord, error) {
	rows, err := s.db(ctx).Query(ctx, `
		SELECT operation, machine_profile_id, machine_profile_revision_id,
		       output_profile_id, output_profile_revision_id,
		       adapter_id, adapter_version, adapter_implementation_digest,
		       version, updated_at, updated_by
		FROM machine_output_selections
		WHERE organization_id = $1
		ORDER BY operation
	`, OrgFromCtx(ctx))
	if err != nil {
		return nil, fmt.Errorf("list machine output selections: %w", err)
	}
	defer rows.Close()
	records := []domain.MachineOutputSelectionRecord{}
	for rows.Next() {
		var rec domain.MachineOutputSelectionRecord
		if err := rows.Scan(
			&rec.Operation, &rec.MachineProfileID, &rec.MachineProfileRevisionID,
			&rec.OutputProfileID, &rec.OutputProfileRevisionID,
			&rec.AdapterID, &rec.AdapterVersion, &rec.AdapterImplementationDigest,
			&rec.Version, &rec.UpdatedAt, &rec.UpdatedBy,
		); err != nil {
			return nil, fmt.Errorf("scan machine output selection: %w", err)
		}
		records = append(records, rec)
	}
	return records, rows.Err()
}

// UpsertMachineOutputSelection writes the exact selection with optimistic
// concurrency: expectedVersion must match the stored version (0 inserts new).
// A stale version returns ErrVersionConflict — never a silent overwrite.
func (s *PostgresStore) UpsertMachineOutputSelection(
	ctx context.Context,
	sel domain.MachineOutputSelection,
	expectedVersion int64,
	updatedBy string,
) (domain.MachineOutputSelectionRecord, error) {
	var rec domain.MachineOutputSelectionRecord
	err := s.db(ctx).QueryRow(ctx, `
		INSERT INTO machine_output_selections (
			organization_id, operation,
			machine_profile_id, machine_profile_revision_id,
			output_profile_id, output_profile_revision_id,
			adapter_id, adapter_version, adapter_implementation_digest,
			version, updated_by
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10)
		ON CONFLICT (organization_id, operation) DO UPDATE SET
			machine_profile_id = EXCLUDED.machine_profile_id,
			machine_profile_revision_id = EXCLUDED.machine_profile_revision_id,
			output_profile_id = EXCLUDED.output_profile_id,
			output_profile_revision_id = EXCLUDED.output_profile_revision_id,
			adapter_id = EXCLUDED.adapter_id,
			adapter_version = EXCLUDED.adapter_version,
			adapter_implementation_digest = EXCLUDED.adapter_implementation_digest,
			version = machine_output_selections.version + 1,
			updated_at = NOW(),
			updated_by = EXCLUDED.updated_by
		WHERE machine_output_selections.version = $11
		RETURNING operation, machine_profile_id, machine_profile_revision_id,
		          output_profile_id, output_profile_revision_id,
		          adapter_id, adapter_version, adapter_implementation_digest,
		          version, updated_at, updated_by
	`,
		OrgFromCtx(ctx), string(sel.Operation),
		sel.MachineProfileID, sel.MachineProfileRevisionID,
		sel.OutputProfileID, sel.OutputProfileRevisionID,
		sel.AdapterID, sel.AdapterVersion, sel.AdapterImplementationDigest,
		updatedBy, expectedVersion,
	).Scan(
		&rec.Operation, &rec.MachineProfileID, &rec.MachineProfileRevisionID,
		&rec.OutputProfileID, &rec.OutputProfileRevisionID,
		&rec.AdapterID, &rec.AdapterVersion, &rec.AdapterImplementationDigest,
		&rec.Version, &rec.UpdatedAt, &rec.UpdatedBy,
	)
	if err == pgx.ErrNoRows {
		// Distinguish stale version from a no-op insert: a row exists only if
		// the ON CONFLICT update was filtered by the version guard.
		var exists bool
		if err := s.db(ctx).QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM machine_output_selections
				WHERE organization_id = $1 AND operation = $2
			)
		`, OrgFromCtx(ctx), string(sel.Operation)).Scan(&exists); err == nil && exists {
			return domain.MachineOutputSelectionRecord{}, ErrVersionConflict
		}
		return domain.MachineOutputSelectionRecord{}, fmt.Errorf("machine output selection upsert returned no row")
	}
	if err != nil {
		return domain.MachineOutputSelectionRecord{}, fmt.Errorf("upsert machine output selection: %w", err)
	}
	return rec, nil
}
