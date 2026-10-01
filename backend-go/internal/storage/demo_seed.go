package storage

import (
	"context"
	"fmt"
)

// EnsureSeedPlatformUser guarantees the Granete platform system identity
// exists (stable seed uuid, platform_admin) and returns its id. The demo
// release publisher FK requires a real user; this is the audit-honest
// system identity for seeded publications.
func (s *PostgresStore) EnsureSeedPlatformUser(ctx context.Context) (string, error) {
	const id = "00000000-0000-0000-0000-0000000000fe"
	const email = "granete-platform@system.local"
	if _, err := s.db(ctx).Exec(ctx, `
		INSERT INTO users (id, email, normalized_email, password_hash, name, account_status, platform_admin)
		VALUES ($1, $2, $2, 'x', 'Granete Platform (sistema)', 'active', TRUE)
		ON CONFLICT (id) DO NOTHING
	`, id, email); err != nil {
		return "", fmt.Errorf("ensure seed platform user: %w", err)
	}
	return id, nil
}
