package storage

import (
	"context"
	"fmt"
)

// LockCatalogCodes (#1553) takes transaction advisory locks on the given
// catalog codes, in the CALLER-provided order (sort before calling: advisory
// locks acquired in different orders by concurrent writers can deadlock).
// The lock lives until the surrounding tenant transaction ends, so two
// concurrent creations of the same code serialize: the loser's duplicate
// pre-check runs AFTER the winner committed and reads a clean 409 instead of
// racing into a mid-transaction unique violation. Benign on the happy path
// (one statement per code) and harmless across unrelated codes that hash
// together (worst case: extra serialization).
func (s *PostgresStore) LockCatalogCodes(ctx context.Context, sortedCodes []string) error {
	for _, code := range sortedCodes {
		if _, err := s.db(ctx).Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", code); err != nil {
			return fmt.Errorf("lock catalog code: %w", err)
		}
	}
	return nil
}
