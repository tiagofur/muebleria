package storage

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #395 / DT-11 authority integration: ONE release authority for every
// production consumer (PR #551 review).
//
// The canonical ProductionRelease is the immutable #395 row
// (production_releases, exact approved DesignRevision + accepted QuoteRevision
// + server-computed manufacturing fingerprint). The OC-022 blob on
// projects.production_release is the pre-Digital-Thread release state:
// client-authored through whole-project PUTs, never server-validated. It
// stays readable as COMPATIBILITY state for projects released through the
// legacy flow before any canonical release exists — it can never compete with
// one once it does, and the project PUT handler freezes it at that point.
//
// Consumers receive domain.ResolvedProductionRelease — the neutral authority
// shape. Canonical releases map onto it directly (ManufacturingFingerprint
// under its own name); the legacy blob maps onto it ONLY through
// domain.ResolveLegacyProductionRelease, the single adapter where the old
// BOMFingerprint token is accepted. No productive code beyond that adapter
// reads BOMFingerprint.

// GetLatestProjectProductionRelease returns the project's newest canonical
// ProductionRelease (highest release_number), or nil when none exists.
func (s *PostgresStore) GetLatestProjectProductionRelease(ctx context.Context, projectID string) (*domain.ProductionRelease, error) {
	if !isValidUUID(projectID) {
		return nil, domain.ErrInvalidReleaseCommand
	}
	release, err := scanProductionRelease(s.db(ctx).QueryRow(ctx, `
		SELECT `+productionReleaseColumns+`
		FROM production_releases
		WHERE project_id = $1
		ORDER BY release_number DESC
		LIMIT 1
	`, projectID))
	if err != nil {
		if errors.Is(err, domain.ErrReleaseNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return release, nil
}

// ResolveProjectReleaseAuthority resolves the ONE release authority for the
// productive subsystems: the canonical #395 release when the project has one
// (exact ID + authoritative manufacturing fingerprint + exact pins), otherwise
// the legacy OC-022 blob through the legacy adapter (pre-DT compatibility).
// Production consumers never read the blob directly — this is the single
// resolution point.
func (s *PostgresStore) ResolveProjectReleaseAuthority(ctx context.Context, projectID string, legacyBlob *domain.LegacyProductionRelease) (*domain.ResolvedProductionRelease, error) {
	canonical, err := s.GetLatestProjectProductionRelease(ctx, projectID)
	if err != nil {
		return nil, err
	}
	if canonical == nil {
		return domain.ResolveLegacyProductionRelease(legacyBlob), nil
	}
	return domain.ResolvedFromCanonicalRelease(canonical), nil
}

// resolveProjectReleaseAuthorityTx is the same resolution on an explicit
// transaction, used by the snapshot loaders that already own one.
func (s *PostgresStore) resolveProjectReleaseAuthorityTx(ctx context.Context, tx pgx.Tx, projectID string, legacyBlob *domain.LegacyProductionRelease) (*domain.ResolvedProductionRelease, error) {
	canonical, err := scanProductionRelease(tx.QueryRow(ctx, `
		SELECT `+productionReleaseColumns+`
		FROM production_releases
		WHERE project_id = $1
		ORDER BY release_number DESC
		LIMIT 1
	`, projectID))
	if err != nil {
		if errors.Is(err, domain.ErrReleaseNotFound) {
			return domain.ResolveLegacyProductionRelease(legacyBlob), nil
		}
		return nil, err
	}
	return domain.ResolvedFromCanonicalRelease(canonical), nil
}
