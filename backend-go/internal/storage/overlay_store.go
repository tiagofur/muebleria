package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #775 [P1][LIB-4]: Organization manufacturing-library overlays and conflict-safe
// 3-way rebase storage operations.

var (
	// ErrOverlayNotFound is returned when an overlay is not found or not accessible via RLS.
	ErrOverlayNotFound = errors.New("library overlay not found")

	// ErrOverlayConflictNotFound is returned when a rebase conflict record is not found.
	ErrOverlayConflictNotFound = errors.New("library overlay conflict not found")

	// ErrOverlayConflictAlreadyResolved is returned when attempting to resolve an already-resolved conflict.
	ErrOverlayConflictAlreadyResolved = errors.New("library overlay conflict already resolved")
)

// CreateOverlay inserts a new organization library overlay.
func (s *PostgresStore) CreateOverlay(ctx context.Context, overlay *domain.LibraryOverlay) (*domain.LibraryOverlay, error) {
	if overlay == nil {
		return nil, errors.New("overlay must not be nil")
	}
	if overlay.ID == uuid.Nil {
		overlay.ID = uuid.New()
	}
	if overlay.Status == "" {
		overlay.Status = "active"
	}
	if len(overlay.Overrides) == 0 {
		overlay.Overrides = json.RawMessage("{}")
	}

	customResourceIDsJSON, err := json.Marshal(overlay.CustomResourceIDs)
	if err != nil {
		return nil, fmt.Errorf("marshal custom_resource_ids: %w", err)
	}

	const query = `
		INSERT INTO library_overlays (
			id, organization_id, library_id, base_release_id, status, overrides, custom_resource_ids, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
		RETURNING id, organization_id, library_id, base_release_id, status, overrides, custom_resource_ids, version, created_at, updated_at`

	row := s.db(ctx).QueryRow(ctx, query,
		overlay.ID,
		overlay.OrganizationID,
		overlay.LibraryID,
		overlay.BaseReleaseID,
		overlay.Status,
		overlay.Overrides,
		customResourceIDsJSON,
	)

	created, err := scanOverlay(row)
	if err != nil {
		return nil, err
	}
	slog.Info("library overlay created", "overlay_id", created.ID, "organization_id", created.OrganizationID, "version", created.Version)
	return created, nil
}

// GetOverlayByID returns a library overlay by its ID (enforced by RLS).
func (s *PostgresStore) GetOverlayByID(ctx context.Context, id uuid.UUID) (*domain.LibraryOverlay, error) {
	const query = `
		SELECT id, organization_id, library_id, base_release_id, status, overrides, custom_resource_ids, version, created_at, updated_at
		FROM library_overlays
		WHERE id = $1`

	row := s.db(ctx).QueryRow(ctx, query, id)
	overlay, err := scanOverlay(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrOverlayNotFound
		}
		return nil, fmt.Errorf("get overlay %s: %w", id, err)
	}
	return overlay, nil
}

// GetActiveOverlayByLibrary returns the active overlay for an organization and library.
func (s *PostgresStore) GetActiveOverlayByLibrary(ctx context.Context, organizationID, libraryID uuid.UUID) (*domain.LibraryOverlay, error) {
	const query = `
		SELECT id, organization_id, library_id, base_release_id, status, overrides, custom_resource_ids, version, created_at, updated_at
		FROM library_overlays
		WHERE organization_id = $1 AND library_id = $2 AND status IN ('active', 'rebase_conflict')
		ORDER BY created_at DESC
		LIMIT 1`

	row := s.db(ctx).QueryRow(ctx, query, organizationID, libraryID)
	overlay, err := scanOverlay(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrOverlayNotFound
		}
		return nil, fmt.Errorf("get active overlay for org %s lib %s: %w", organizationID, libraryID, err)
	}
	return overlay, nil
}

// UpdateOverlayOverrides updates the overrides payload and custom resources
// list of an overlay under OPTIMISTIC CONCURRENCY (#875 slice 4): the update
// lands only when `expectedVersion` still matches, and every landing update
// bumps the version. Zero rows mean either a lost race (ErrVersionConflict —
// another editor wrote first) or an absent overlay (ErrOverlayNotFound);
// callers surface the conflict instead of silently overwriting.
func (s *PostgresStore) UpdateOverlayOverrides(
	ctx context.Context,
	id uuid.UUID,
	expectedVersion int64,
	overrides json.RawMessage,
	customResourceIDs []uuid.UUID,
) error {
	if len(overrides) == 0 {
		overrides = json.RawMessage("{}")
	}
	customResourceIDsJSON, err := json.Marshal(customResourceIDs)
	if err != nil {
		return fmt.Errorf("marshal custom_resource_ids: %w", err)
	}

	const query = `
		UPDATE library_overlays
		SET overrides = $2,
		    custom_resource_ids = $3,
		    version = version + 1,
		    updated_at = NOW()
		WHERE id = $1 AND version = $4
		RETURNING version`

	var newVersion int64
	err = s.db(ctx).QueryRow(ctx, query, id, overrides, customResourceIDsJSON, expectedVersion).Scan(&newVersion)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			var exists bool
			if scanErr := s.db(ctx).QueryRow(ctx,
				`SELECT EXISTS (SELECT 1 FROM library_overlays WHERE id = $1)`, id).Scan(&exists); scanErr == nil && !exists {
				return ErrOverlayNotFound
			}
			return ErrVersionConflict
		}
		return fmt.Errorf("update overlay overrides %s: %w", id, err)
	}
	return nil
}

// UpdateOverlayStatus updates the status of an overlay.
func (s *PostgresStore) UpdateOverlayStatus(ctx context.Context, id uuid.UUID, status string) error {
	const query = `
		UPDATE library_overlays
		SET status = $2,
		    updated_at = NOW()
		WHERE id = $1`

	tag, err := s.db(ctx).Exec(ctx, query, id, status)
	if err != nil {
		return fmt.Errorf("update overlay status %s: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return ErrOverlayNotFound
	}
	return nil
}

// UpdateOverlayBaseRelease atomically updates the base release and overrides following a rebase.
func (s *PostgresStore) UpdateOverlayBaseRelease(
	ctx context.Context,
	id uuid.UUID,
	newBaseReleaseID uuid.UUID,
	overrides json.RawMessage,
	status string,
) error {
	if len(overrides) == 0 {
		overrides = json.RawMessage("{}")
	}

	const query = `
		UPDATE library_overlays
		SET base_release_id = $2,
		    overrides = $3,
		    status = $4,
		    updated_at = NOW()
		WHERE id = $1`

	tag, err := s.db(ctx).Exec(ctx, query, id, newBaseReleaseID, overrides, status)
	if err != nil {
		return fmt.Errorf("update overlay base release %s: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return ErrOverlayNotFound
	}
	return nil
}

// ReplaceOverlayPendingConflicts replaces all pending conflicts for an overlay with a new set.
func (s *PostgresStore) ReplaceOverlayPendingConflicts(
	ctx context.Context,
	overlayID uuid.UUID,
	conflicts []domain.LibraryOverlayConflict,
) error {
	tx, err := s.beginTx(ctx)
	if err != nil {
		return fmt.Errorf("begin replace conflicts tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Delete existing pending conflicts for this overlay
	const deletePending = `
		DELETE FROM library_overlay_conflicts
		WHERE overlay_id = $1 AND status = 'pending'`

	if _, err := tx.Exec(ctx, deletePending, overlayID); err != nil {
		return fmt.Errorf("delete pending conflicts for overlay %s: %w", overlayID, err)
	}

	const insertQuery = `
		INSERT INTO library_overlay_conflicts (
			id, overlay_id, organization_id, old_base_release_id, new_base_release_id,
			conflict_type, path, old_base_value, new_base_value, custom_value,
			status, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`

	for _, c := range conflicts {
		conflictID := c.ID
		if conflictID == uuid.Nil {
			conflictID = uuid.New()
		}

		oldValJSON, err := marshalNullableJSON(c.OldBaseValue)
		if err != nil {
			return fmt.Errorf("marshal old_base_value for %s: %w", c.Path, err)
		}
		newValJSON, err := marshalNullableJSON(c.NewBaseValue)
		if err != nil {
			return fmt.Errorf("marshal new_base_value for %s: %w", c.Path, err)
		}
		customValJSON, err := marshalNullableJSON(c.CustomValue)
		if err != nil {
			return fmt.Errorf("marshal custom_value for %s: %w", c.Path, err)
		}

		status := c.Status
		if status == "" {
			status = "pending"
		}

		if _, err := tx.Exec(ctx, insertQuery,
			conflictID,
			c.OverlayID,
			c.OrganizationID,
			c.OldBaseReleaseID,
			c.NewBaseReleaseID,
			string(c.ConflictType),
			c.Path,
			oldValJSON,
			newValJSON,
			customValJSON,
			status,
		); err != nil {
			return fmt.Errorf("insert conflict for path %s: %w", c.Path, err)
		}
	}

	return tx.Commit(ctx)
}

// ListOverlayConflicts returns all conflicts for an overlay, optionally filtered by status.
func (s *PostgresStore) ListOverlayConflicts(
	ctx context.Context,
	overlayID uuid.UUID,
	statusFilter string,
) ([]domain.LibraryOverlayConflict, error) {
	const query = `
		SELECT id, overlay_id, organization_id, old_base_release_id, new_base_release_id,
		       conflict_type, path, old_base_value, new_base_value, custom_value,
		       status, resolution_action, resolved_value, resolved_by, resolved_at, created_at
		FROM library_overlay_conflicts
		WHERE overlay_id = $1
		  AND ($2 = '' OR status = $2)
		ORDER BY created_at ASC`

	rows, err := s.db(ctx).Query(ctx, query, overlayID, statusFilter)
	if err != nil {
		return nil, fmt.Errorf("list overlay conflicts for %s: %w", overlayID, err)
	}
	defer rows.Close()

	var conflicts []domain.LibraryOverlayConflict
	for rows.Next() {
		c, err := scanOverlayConflict(rows)
		if err != nil {
			return nil, fmt.Errorf("scan overlay conflict: %w", err)
		}
		conflicts = append(conflicts, *c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate overlay conflicts: %w", err)
	}

	return conflicts, nil
}

// GetOverlayConflictByID retrieves a single conflict record by its ID.
func (s *PostgresStore) GetOverlayConflictByID(ctx context.Context, conflictID uuid.UUID) (*domain.LibraryOverlayConflict, error) {
	const query = `
		SELECT id, overlay_id, organization_id, old_base_release_id, new_base_release_id,
		       conflict_type, path, old_base_value, new_base_value, custom_value,
		       status, resolution_action, resolved_value, resolved_by, resolved_at, created_at
		FROM library_overlay_conflicts
		WHERE id = $1`

	row := s.db(ctx).QueryRow(ctx, query, conflictID)
	c, err := scanOverlayConflict(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrOverlayConflictNotFound
		}
		return nil, fmt.Errorf("get overlay conflict %s: %w", conflictID, err)
	}
	return c, nil
}

// ResolveOverlayConflict marks a conflict as resolved with an explicit resolution action and value.
func (s *PostgresStore) ResolveOverlayConflict(
	ctx context.Context,
	conflictID uuid.UUID,
	action domain.ResolutionAction,
	resolvedValue any,
	resolvedBy *uuid.UUID,
) error {
	resolvedValJSON, err := marshalNullableJSON(resolvedValue)
	if err != nil {
		return fmt.Errorf("marshal resolved_value: %w", err)
	}

	const query = `
		UPDATE library_overlay_conflicts
		SET status = 'resolved',
		    resolution_action = $2,
		    resolved_value = $3,
		    resolved_by = $4,
		    resolved_at = NOW()
		WHERE id = $1
		  AND status = 'pending'`

	tag, err := s.db(ctx).Exec(ctx, query, conflictID, string(action), resolvedValJSON, resolvedBy)
	if err != nil {
		return fmt.Errorf("resolve overlay conflict %s: %w", conflictID, err)
	}
	if tag.RowsAffected() == 0 {
		c, lookupErr := s.GetOverlayConflictByID(ctx, conflictID)
		if lookupErr != nil {
			return lookupErr
		}
		if c.Status == "resolved" {
			return ErrOverlayConflictAlreadyResolved
		}
		return fmt.Errorf("resolve conflict %s: no rows affected", conflictID)
	}
	return nil
}

// CountPendingConflicts returns the count of unresolved conflicts for an overlay.
func (s *PostgresStore) CountPendingConflicts(ctx context.Context, overlayID uuid.UUID) (int, error) {
	const query = `
		SELECT COUNT(*)
		FROM library_overlay_conflicts
		WHERE overlay_id = $1 AND status = 'pending'`

	var count int
	err := s.db(ctx).QueryRow(ctx, query, overlayID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count pending conflicts for %s: %w", overlayID, err)
	}
	return count, nil
}

// ─── Helpers & Scanners ───────────────────────────────────────────────────────

type scannableRow interface {
	Scan(dest ...any) error
}

func scanOverlay(row scannableRow) (*domain.LibraryOverlay, error) {
	var o domain.LibraryOverlay
	var customResourceIDsBytes []byte

	err := row.Scan(
		&o.ID,
		&o.OrganizationID,
		&o.LibraryID,
		&o.BaseReleaseID,
		&o.Status,
		&o.Overrides,
		&customResourceIDsBytes,
		&o.Version,
		&o.CreatedAt,
		&o.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	if len(customResourceIDsBytes) > 0 {
		if err := json.Unmarshal(customResourceIDsBytes, &o.CustomResourceIDs); err != nil {
			return nil, fmt.Errorf("unmarshal custom_resource_ids: %w", err)
		}
	}
	if o.CustomResourceIDs == nil {
		o.CustomResourceIDs = make([]uuid.UUID, 0)
	}

	return &o, nil
}

func scanOverlayConflict(row scannableRow) (*domain.LibraryOverlayConflict, error) {
	var c domain.LibraryOverlayConflict
	var conflictTypeStr string
	var oldBaseValBytes, newBaseValBytes, customValBytes, resolvedValBytes []byte
	var resolutionActionStr *string

	err := row.Scan(
		&c.ID,
		&c.OverlayID,
		&c.OrganizationID,
		&c.OldBaseReleaseID,
		&c.NewBaseReleaseID,
		&conflictTypeStr,
		&c.Path,
		&oldBaseValBytes,
		&newBaseValBytes,
		&customValBytes,
		&c.Status,
		&resolutionActionStr,
		&resolvedValBytes,
		&c.ResolvedBy,
		&c.ResolvedAt,
		&c.CreatedAt,
	)
	if err != nil {
		return nil, err
	}

	c.ConflictType = domain.RebaseConflictType(conflictTypeStr)
	if resolutionActionStr != nil {
		action := domain.ResolutionAction(*resolutionActionStr)
		c.ResolutionAction = &action
	}

	c.OldBaseValue = unmarshalNullableJSON(oldBaseValBytes)
	c.NewBaseValue = unmarshalNullableJSON(newBaseValBytes)
	c.CustomValue = unmarshalNullableJSON(customValBytes)
	c.ResolvedValue = unmarshalNullableJSON(resolvedValBytes)

	return &c, nil
}

func marshalNullableJSON(v any) ([]byte, error) {
	if v == nil {
		return nil, nil
	}
	return json.Marshal(v)
}

func unmarshalNullableJSON(data []byte) any {
	if len(data) == 0 || string(data) == "null" {
		return nil
	}
	var res any
	if err := json.Unmarshal(data, &res); err != nil {
		return string(data)
	}
	return res
}
