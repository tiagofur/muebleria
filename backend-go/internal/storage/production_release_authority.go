package storage

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #395 / DT-11 authority integration: ONE release authority for every
// production consumer (review blocker on PR #551).
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
// Every legacy production consumer surface (material planning, job costing,
// quality, part executions) resolves its release state THROUGH this function:
// canonical wins unconditionally; only a project without a canonical release
// falls back to the blob. The mapping into the legacy consumer shape is a
// read-only projection — canonical releases are immutable history.

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

// ResolveProjectReleaseAuthority projects the ONE release authority into the
// legacy consumer shape: the canonical #395 release when the project has one
// (ID + authoritative manufacturing fingerprint + exact pins), otherwise the
// stored OC-022 blob. Production consumers never read the blob directly
// anymore — this is the single resolution point.
func (s *PostgresStore) ResolveProjectReleaseAuthority(ctx context.Context, projectID string, legacyBlob *domain.LegacyProductionRelease) (*domain.LegacyProductionRelease, error) {
	canonical, err := s.GetLatestProjectProductionRelease(ctx, projectID)
	if err != nil {
		return nil, err
	}
	if canonical == nil {
		return legacyBlob, nil
	}
	return legacyProjectionOfCanonicalRelease(canonical), nil
}

// resolveProjectReleaseAuthorityTx is the same resolution on an explicit
// transaction, used by the snapshot loaders that already own one.
func (s *PostgresStore) resolveProjectReleaseAuthorityTx(ctx context.Context, tx pgx.Tx, projectID string, legacyBlob *domain.LegacyProductionRelease) (*domain.LegacyProductionRelease, error) {
	canonical, err := scanProductionRelease(tx.QueryRow(ctx, `
		SELECT `+productionReleaseColumns+`
		FROM production_releases
		WHERE project_id = $1
		ORDER BY release_number DESC
		LIMIT 1
	`, projectID))
	if err != nil {
		if errors.Is(err, domain.ErrReleaseNotFound) {
			return legacyBlob, nil
		}
		return nil, err
	}
	return legacyProjectionOfCanonicalRelease(canonical), nil
}

// legacyProjectionOfCanonicalRelease maps the canonical release into the
// legacy consumer shape: the authoritative manufacturing fingerprint rides in
// the BOMFingerprint slot and the exact design revision pin travels along.
// ProjectVersion stays zero — the canonical authority pins identity by
// ReleaseID + fingerprint, not by a client-invented version counter.
func legacyProjectionOfCanonicalRelease(canonical *domain.ProductionRelease) *domain.LegacyProductionRelease {
	return &domain.LegacyProductionRelease{
		ID:               canonical.ID,
		ProjectID:        canonical.ProjectID,
		DesignRevisionID: canonical.DesignRevisionID,
		BOMFingerprint:   canonical.ManufacturingFingerprint,
		ReleasedBy:       canonical.ReleasedBy,
		ReleasedAt:       canonical.ReleasedAt,
		Note:             "canonical digital-thread production release (#395)",
	}
}
