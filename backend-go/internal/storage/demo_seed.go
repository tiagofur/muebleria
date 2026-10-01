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

// ResetManifestlessPublishedRelease flips a "published" release that has no
// materialized manifest back to draft, so the demo seed can publish it for
// real. PublishReleaseWithManifest writes the manifest row and the published
// status in one transaction, so a committed release without a manifest is not
// a real publication — it is a fixture that borrowed the published status. A
// genuinely published release (manifest row present) is never touched, and
// published_by is cleared with the rest of the publication provenance so the
// demoted row does not keep crediting the fixture's publisher.
//
// This runs in its own transaction, so between it and the recompile the
// Standard library has no published release at all. That gap is acceptable for
// a demo seed; a path that mattered operationally would need both steps in one
// transaction.
func (s *PostgresStore) ResetManifestlessPublishedRelease(ctx context.Context, releaseID string) (bool, error) {
	tag, err := s.db(ctx).Exec(ctx, `
		UPDATE library_releases
		SET status = 'draft', manifest_hash = NULL, published_at = NULL,
		    published_by = NULL, updated_at = NOW()
		WHERE id = $1 AND status = 'published'
		  AND NOT EXISTS (SELECT 1 FROM library_release_manifests WHERE release_id = $1)
	`, releaseID)
	if err != nil {
		return false, fmt.Errorf("reset manifestless published release: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}
