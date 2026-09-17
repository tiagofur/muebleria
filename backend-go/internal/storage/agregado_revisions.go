package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// --- AGREGADO REVISIONS & PUBLISHED ASSEMBLY SNAPSHOTS (#670 Increment B) ---

// CreateAgregadoRevision stores an immutable append-only recipe revision for an Agregado.
// Locks the parent agregados row with FOR UPDATE to serialize revision number allocation safely under concurrency.
// Scoped strictly to (organization_id, agregado_id, revision_number).
func (s *PostgresStore) CreateAgregadoRevision(
	ctx context.Context,
	agregadoID string,
	recipe domain.AgregadoRecipePayload,
	createdBy *string,
) (*domain.AgregadoRevision, error) {
	orgID := OrgFromCtx(ctx)
	if orgID == "" {
		return nil, errors.New("organization id required in context")
	}

	recipeJSON, err := json.Marshal(recipe)
	if err != nil {
		return nil, fmt.Errorf("marshal agregado recipe: %w", err)
	}

	tx, err := s.beginTx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Lock the parent agregado to serialize revision allocations for this agregado within this tenant
	var dummy string
	err = tx.QueryRow(ctx, `
		SELECT id FROM agregados
		WHERE id = $1 AND organization_id = $2
		FOR UPDATE
	`, agregadoID, orgID).Scan(&dummy)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("agregado not found: %s", agregadoID)
		}
		return nil, fmt.Errorf("lock agregado for revision: %w", err)
	}

	// Compute next sequential revision number scoped strictly to organization and agregado
	var nextRev int
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(MAX(revision_number), 0) + 1
		FROM agregado_revisions
		WHERE agregado_id = $1 AND organization_id = $2
	`, agregadoID, orgID).Scan(&nextRev)
	if err != nil {
		return nil, fmt.Errorf("calculate next revision number: %w", err)
	}

	query := `
		INSERT INTO agregado_revisions (
			organization_id, agregado_id, revision_number, recipe, created_by, created_at
		) VALUES (
			$1, $2, $3, $4, $5::UUID, NOW()
		)
		RETURNING id, created_at
	`
	var id string
	var createdAt time.Time
	err = tx.QueryRow(ctx, query, orgID, agregadoID, nextRev, recipeJSON, createdBy).Scan(&id, &createdAt)
	if err != nil {
		if isUniqueViolationOn(err, "uq_agregado_revisions_number") {
			return nil, fmt.Errorf("%w: revision %d already exists for agregado %s", domain.ErrAgregadoRevisionConflict, nextRev, agregadoID)
		}
		return nil, fmt.Errorf("insert agregado revision: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit agregado revision: %w", err)
	}

	return &domain.AgregadoRevision{
		ID:             id,
		OrganizationID: orgID,
		AgregadoID:     agregadoID,
		RevisionNumber: nextRev,
		Recipe:         recipe,
		CreatedBy:      createdBy,
		CreatedAt:      createdAt,
	}, nil
}

// GetAgregadoRevisionByID retrieves an exact immutable revision by its UUID.
func (s *PostgresStore) GetAgregadoRevisionByID(ctx context.Context, revisionID string) (*domain.AgregadoRevision, error) {
	orgID := OrgFromCtx(ctx)
	query := `
		SELECT id, organization_id, agregado_id, revision_number, recipe, created_by, created_at
		FROM agregado_revisions
		WHERE id = $1 AND organization_id = $2
	`
	row := s.db(ctx).QueryRow(ctx, query, revisionID, orgID)
	return scanAgregadoRevision(row)
}

// GetAgregadoRevisionByNumber retrieves an exact revision by agregado ID and revision number.
func (s *PostgresStore) GetAgregadoRevisionByNumber(ctx context.Context, agregadoID string, revisionNumber int) (*domain.AgregadoRevision, error) {
	orgID := OrgFromCtx(ctx)
	query := `
		SELECT id, organization_id, agregado_id, revision_number, recipe, created_by, created_at
		FROM agregado_revisions
		WHERE agregado_id = $1 AND revision_number = $2 AND organization_id = $3
	`
	row := s.db(ctx).QueryRow(ctx, query, agregadoID, revisionNumber, orgID)
	return scanAgregadoRevision(row)
}

// ListAgregadoRevisions returns all revisions for an agregado in ascending revision order.
func (s *PostgresStore) ListAgregadoRevisions(ctx context.Context, agregadoID string) ([]domain.AgregadoRevision, error) {
	orgID := OrgFromCtx(ctx)
	query := `
		SELECT id, organization_id, agregado_id, revision_number, recipe, created_by, created_at
		FROM agregado_revisions
		WHERE agregado_id = $1 AND organization_id = $2
		ORDER BY revision_number ASC
	`
	rows, err := s.db(ctx).Query(ctx, query, agregadoID, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.AgregadoRevision
	for rows.Next() {
		rev, err := scanAgregadoRevision(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *rev)
	}
	if list == nil {
		list = []domain.AgregadoRevision{}
	}
	return list, rows.Err()
}

// SetAgregadoCurrentRevision updates the current_revision_id pointer of an agregado.
// Guaranteed by database foreign key constraint fk_agregados_current_revision to require
// the revision to exist, belong to the exact same agregado, and belong to the exact same organization.
func (s *PostgresStore) SetAgregadoCurrentRevision(ctx context.Context, agregadoID, revisionID string) error {
	orgID := OrgFromCtx(ctx)
	if strings.TrimSpace(orgID) == "" {
		return errors.New("organization id required in context")
	}
	query := `
		UPDATE agregados
		SET current_revision_id = $1, updated_at = NOW()
		WHERE id = $2 AND organization_id = $3
	`
	tag, err := s.db(ctx).Exec(ctx, query, revisionID, agregadoID, orgID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23503" {
			return fmt.Errorf("%w: revision %s does not exist for agregado %s in organization %s",
				domain.ErrAgregadoRevisionNotFound, revisionID, agregadoID, orgID)
		}
		return fmt.Errorf("update agregado current_revision_id: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("agregado not found: %s", agregadoID)
	}
	return nil
}

// GetAgregadoCurrentRevision retrieves the current active recipe revision for an agregado.
func (s *PostgresStore) GetAgregadoCurrentRevision(ctx context.Context, agregadoID string) (*domain.AgregadoRevision, error) {
	orgID := OrgFromCtx(ctx)
	query := `
		SELECT r.id, r.organization_id, r.agregado_id, r.revision_number, r.recipe, r.created_by, r.created_at
		FROM agregados a
		JOIN agregado_revisions r ON r.id = a.current_revision_id AND r.organization_id = a.organization_id AND r.agregado_id = a.id
		WHERE a.id = $1 AND a.organization_id = $2
	`
	row := s.db(ctx).QueryRow(ctx, query, agregadoID, orgID)
	return scanAgregadoRevision(row)
}

// SavePublishedAssemblySnapshot idempotently saves a frozen assembly resolution snapshot.
// Scoped to (organization_id, agregado_revision_id, payload_hash) to guarantee that distinct
// recipe revisions never collide or silently alias each other, while repeated publish retries
// for the same recipe revision return the existing snapshot idempotently.
func (s *PostgresStore) SavePublishedAssemblySnapshot(ctx context.Context, record *domain.PublishedAssemblySnapshotRecord) error {
	orgID := OrgFromCtx(ctx)
	if orgID == "" {
		return errors.New("organization id required in context")
	}

	if err := domain.ValidatePublishedAssemblySnapshot(record.Snapshot); err != nil {
		return fmt.Errorf("validate published assembly snapshot: %w", err)
	}

	snapshotJSON, err := json.Marshal(record.Snapshot)
	if err != nil {
		return fmt.Errorf("marshal snapshot: %w", err)
	}

	if record.PayloadHash == "" {
		h, err := domain.ComputePublishedAssemblySnapshotHash(record.Snapshot)
		if err != nil {
			return err
		}
		record.PayloadHash = h
	}

	query := `
		INSERT INTO published_assembly_snapshots (
			id, organization_id, agregado_id, agregado_revision_id, agregado_revision_number,
			resolved_width_mm, resolved_depth_mm, resolved_height_mm, payload_hash, snapshot, created_by, created_at
		) VALUES (
			COALESCE(NULLIF($1, '')::UUID, gen_random_uuid()), $2, $3, $4::UUID, $5,
			$6, $7, $8, $9, $10, $11::UUID, NOW()
		)
		ON CONFLICT (organization_id, agregado_revision_id, payload_hash) DO NOTHING
		RETURNING id, created_at
	`
	var id string
	var createdAt time.Time
	err = s.db(ctx).QueryRow(
		ctx, query,
		record.ID, orgID, record.AgregadoID, record.AgregadoRevisionID, record.AgregadoRevisionNumber,
		record.ResolvedWidthMm, record.ResolvedDepthMm, record.ResolvedHeightMm, record.PayloadHash, snapshotJSON, record.CreatedBy,
	).Scan(&id, &createdAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Idempotent duplicate: fetch existing snapshot record for this exact recipe revision
			err = s.db(ctx).QueryRow(ctx, `
				SELECT id, created_at FROM published_assembly_snapshots
				WHERE organization_id = $1 AND agregado_revision_id = $2 AND payload_hash = $3
			`, orgID, record.AgregadoRevisionID, record.PayloadHash).Scan(&id, &createdAt)
			if err != nil {
				return fmt.Errorf("retrieve existing idempotent published snapshot: %w", err)
			}
		} else {
			return fmt.Errorf("insert published assembly snapshot: %w", err)
		}
	}

	record.ID = id
	record.OrganizationID = orgID
	record.CreatedAt = createdAt
	return nil
}

// GetPublishedAssemblySnapshotByID retrieves and validates an exact frozen snapshot.
// Validates on readback (R16): any payload corruption fails closed with ErrCorruptAssemblySnapshot.
// Never re-evaluates recipes or resolvers.
func (s *PostgresStore) GetPublishedAssemblySnapshotByID(ctx context.Context, snapshotID string) (*domain.PublishedAssemblySnapshotRecord, error) {
	orgID := OrgFromCtx(ctx)
	query := `
		SELECT id, organization_id, agregado_id, agregado_revision_id, agregado_revision_number,
		       resolved_width_mm, resolved_depth_mm, resolved_height_mm, payload_hash, snapshot, created_by, created_at
		FROM published_assembly_snapshots
		WHERE id = $1 AND organization_id = $2
	`
	var (
		rec         domain.PublishedAssemblySnapshotRecord
		snapshotRaw []byte
	)
	err := s.db(ctx).QueryRow(ctx, query, snapshotID, orgID).Scan(
		&rec.ID, &rec.OrganizationID, &rec.AgregadoID, &rec.AgregadoRevisionID, &rec.AgregadoRevisionNumber,
		&rec.ResolvedWidthMm, &rec.ResolvedDepthMm, &rec.ResolvedHeightMm, &rec.PayloadHash, &snapshotRaw, &rec.CreatedBy, &rec.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrAssemblySnapshotNotFound
		}
		return nil, err
	}

	if err := json.Unmarshal(snapshotRaw, &rec.Snapshot); err != nil {
		return nil, fmt.Errorf("%w: failed to unmarshal snapshot JSON: %v", domain.ErrCorruptAssemblySnapshot, err)
	}

	// Validate readback fail-closed (R16)
	if err := domain.ValidatePublishedAssemblySnapshot(rec.Snapshot); err != nil {
		return nil, fmt.Errorf("readback validation failed: %w", err)
	}

	return &rec, nil
}

// PinDesignRevisionAssemblySnapshot pins a frozen published assembly snapshot to a DesignRevision.
func (s *PostgresStore) PinDesignRevisionAssemblySnapshot(ctx context.Context, pin *domain.DesignRevisionAssemblySnapshot) error {
	orgID := OrgFromCtx(ctx)
	if pin.OrganizationID == "" {
		pin.OrganizationID = orgID
	}
	if pin.OrganizationID == "" {
		return errors.New("organization id required in context or pin")
	}

	query := `
		INSERT INTO design_revision_assembly_snapshots (
			id, organization_id, project_id, design_revision_id, furniture_instance_id,
			agregado_id, slot_key, snapshot_id, created_at
		) VALUES (
			COALESCE(NULLIF($1, '')::UUID, gen_random_uuid()), $2, $3::UUID, $4::UUID, $5::UUID,
			$6, $7, $8::UUID, NOW()
		)
		RETURNING id, created_at
	`
	var id string
	var createdAt time.Time
	err := s.db(ctx).QueryRow(
		ctx, query,
		pin.ID, pin.OrganizationID, pin.ProjectID, pin.DesignRevisionID, pin.FurnitureInstanceID,
		pin.AgregadoID, pin.SlotKey, pin.SnapshotID,
	).Scan(&id, &createdAt)
	if err != nil {
		return fmt.Errorf("insert design revision assembly snapshot pin: %w", err)
	}

	pin.ID = id
	pin.CreatedAt = createdAt
	return nil
}

// ListDesignRevisionAssemblySnapshots returns all assembly snapshots pinned to a DesignRevision.
func (s *PostgresStore) ListDesignRevisionAssemblySnapshots(ctx context.Context, projectID, designRevisionID string) ([]domain.DesignRevisionAssemblySnapshot, error) {
	query := `
		SELECT id, organization_id, project_id, design_revision_id, furniture_instance_id, agregado_id, slot_key, snapshot_id, created_at
		FROM design_revision_assembly_snapshots
		WHERE project_id = $1 AND design_revision_id = $2
		ORDER BY created_at ASC, id ASC
	`
	rows, err := s.db(ctx).Query(ctx, query, projectID, designRevisionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.DesignRevisionAssemblySnapshot
	for rows.Next() {
		var pin domain.DesignRevisionAssemblySnapshot
		if err := rows.Scan(
			&pin.ID, &pin.OrganizationID, &pin.ProjectID, &pin.DesignRevisionID,
			&pin.FurnitureInstanceID, &pin.AgregadoID, &pin.SlotKey, &pin.SnapshotID, &pin.CreatedAt,
		); err != nil {
			return nil, err
		}
		list = append(list, pin)
	}
	if list == nil {
		list = []domain.DesignRevisionAssemblySnapshot{}
	}
	return list, rows.Err()
}

// GetDesignRevisionAssemblySnapshot retrieves an exact assembly snapshot pinned to a DesignRevision without instance.
func (s *PostgresStore) GetDesignRevisionAssemblySnapshot(
	ctx context.Context,
	projectID, designRevisionID, agregadoID, slotKey string,
) (*domain.DesignRevisionAssemblySnapshot, error) {
	query := `
		SELECT id, organization_id, project_id, design_revision_id, furniture_instance_id, agregado_id, slot_key, snapshot_id, created_at
		FROM design_revision_assembly_snapshots
		WHERE project_id = $1 AND design_revision_id = $2 AND agregado_id = $3 AND slot_key = $4
	`
	var pin domain.DesignRevisionAssemblySnapshot
	err := s.db(ctx).QueryRow(ctx, query, projectID, designRevisionID, agregadoID, slotKey).Scan(
		&pin.ID, &pin.OrganizationID, &pin.ProjectID, &pin.DesignRevisionID,
		&pin.FurnitureInstanceID, &pin.AgregadoID, &pin.SlotKey, &pin.SnapshotID, &pin.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrAssemblySnapshotNotFound
		}
		return nil, err
	}
	return &pin, nil
}

// GetDesignRevisionAssemblySnapshotForInstance retrieves an assembly snapshot pinned to a specific furniture instance within a DesignRevision.
func (s *PostgresStore) GetDesignRevisionAssemblySnapshotForInstance(
	ctx context.Context,
	projectID, designRevisionID, furnitureInstanceID, slotKey string,
) (*domain.DesignRevisionAssemblySnapshot, error) {
	query := `
		SELECT id, organization_id, project_id, design_revision_id, furniture_instance_id, agregado_id, slot_key, snapshot_id, created_at
		FROM design_revision_assembly_snapshots
		WHERE project_id = $1 AND design_revision_id = $2 AND furniture_instance_id = $3::UUID AND slot_key = $4
	`
	var pin domain.DesignRevisionAssemblySnapshot
	err := s.db(ctx).QueryRow(ctx, query, projectID, designRevisionID, furnitureInstanceID, slotKey).Scan(
		&pin.ID, &pin.OrganizationID, &pin.ProjectID, &pin.DesignRevisionID,
		&pin.FurnitureInstanceID, &pin.AgregadoID, &pin.SlotKey, &pin.SnapshotID, &pin.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrAssemblySnapshotNotFound
		}
		return nil, err
	}
	return &pin, nil
}

func scanAgregadoRevision(r rowScanner) (*domain.AgregadoRevision, error) {
	var (
		rev       domain.AgregadoRevision
		recipeRaw []byte
	)
	err := r.Scan(
		&rev.ID,
		&rev.OrganizationID,
		&rev.AgregadoID,
		&rev.RevisionNumber,
		&recipeRaw,
		&rev.CreatedBy,
		&rev.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrAgregadoRevisionNotFound
		}
		return nil, err
	}
	if len(recipeRaw) > 0 {
		if err := json.Unmarshal(recipeRaw, &rev.Recipe); err != nil {
			return nil, fmt.Errorf("unmarshal agregado recipe: %w", err)
		}
	}
	return &rev, nil
}
