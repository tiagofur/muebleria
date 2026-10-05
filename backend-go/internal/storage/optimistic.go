package storage

import (
	"context"
	"fmt"
)

// disambiguateRowNotFound distinguishes a missing row from a stale
// optimistic-concurrency version after a guarded write surfaced
// pgx.ErrNoRows or zero affected rows: the caller passes the family's
// not-found error and gets it back when the row truly does not exist, or
// ErrVersionConflict when the row is there but moved on (#443/#448).
// tableName must be a code literal — it is interpolated into the probe, never
// user input.
func (s *PostgresStore) disambiguateRowNotFound(ctx context.Context, tableName, id string, notFoundErr error) error {
	var exists bool
	if err := s.db(ctx).QueryRow(ctx,
		"SELECT EXISTS (SELECT 1 FROM "+tableName+" WHERE id = $1 AND organization_id = $2)",
		id, OrgFromCtx(ctx)).Scan(&exists); err != nil {
		return fmt.Errorf("error checking %s existence: %w", tableName, err)
	}
	if !exists {
		return notFoundErr
	}
	return ErrVersionConflict
}
