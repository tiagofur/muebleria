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
		SELECT `+productionReleaseColumns+productionReleaseFrom+`
		WHERE pr.project_id = $1
		ORDER BY pr.release_number DESC
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

// resolveReleaseProjection maps the batch-loaded latest canonical release (or
// the legacy blob when none exists) onto the project read-model authority
// projection (#577 / OPS-DT-1). Canonical ALWAYS wins when both exist.
func resolveReleaseProjection(canonical *domain.ProductionRelease, legacy *domain.LegacyProductionRelease) *domain.ResolvedProductionRelease {
	if canonical != nil {
		return domain.ResolvedFromCanonicalRelease(canonical)
	}
	return domain.ResolveLegacyProductionRelease(legacy)
}

// resolveProjectReleaseAuthorityTx is the same resolution on an explicit
// transaction, used by the snapshot loaders that already own one.
func (s *PostgresStore) resolveProjectReleaseAuthorityTx(ctx context.Context, tx pgx.Tx, projectID string, legacyBlob *domain.LegacyProductionRelease) (*domain.ResolvedProductionRelease, error) {
	canonical, err := scanProductionRelease(tx.QueryRow(ctx, `
		SELECT `+productionReleaseColumns+productionReleaseFrom+`
		WHERE pr.project_id = $1
		ORDER BY pr.release_number DESC
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

// guardCanonicalExecutionRouting is the shared fail-closed guard for EVERY
// command that can write physical execution state (part instances, module
// units, station progress, quality gates) on a project with a canonical
// release. It first validates the exact private frozen pair — P1 release,
// DesignRevision and manufacturing fingerprint — under the caller's project
// row lock; schema v1 freezes BOM demand, not machining coverage, so the
// command then fails closed: neither client routes nor a current catalog can
// supply the missing immutable routing evidence. Legacy-only projects never
// reach this guard.
func (s *PostgresStore) guardCanonicalExecutionRouting(ctx context.Context, tx pgx.Tx, projectID string, authority *domain.ResolvedProductionRelease) error {
	frozen, err := s.GetProductionReleaseManufacturingSnapshot(
		context.WithValue(ctx, transactionContextKey{}, tx), projectID, authority.ReleaseID)
	if err != nil {
		return err
	}
	if frozen.Release.DesignRevisionID != authority.DesignRevisionID ||
		frozen.Release.ManufacturingFingerprint != authority.ManufacturingFingerprint {
		return ErrReleaseSnapshotUnavailable
	}
	return ErrReleaseRoutingUnavailable
}

// getProjectProductionReleaseTx loads one EXACT canonical release of the
// project on an explicit transaction (#577 / OPS-DT-1). Missing and
// cross-project are the same not-found answer so no foreign release id can
// ever be stamped as an authority.
func (s *PostgresStore) getProjectProductionReleaseTx(ctx context.Context, tx pgx.Tx, projectID, releaseID string) (*domain.ProductionRelease, error) {
	if !isValidUUID(projectID) || !isValidUUID(releaseID) {
		return nil, domain.ErrReleaseNotFound
	}
	return scanProductionRelease(tx.QueryRow(ctx, `
		SELECT `+productionReleaseColumns+productionReleaseFrom+`
		WHERE pr.id = $1 AND pr.project_id = $2
	`, releaseID, projectID))
}

// LatestCanonicalReleasesByProject loads each project's newest canonical
// release in ONE query (#577 / OPS-DT-1) so the project list read model can
// expose the resolved authority projection without per-project lookups.
func (s *PostgresStore) LatestCanonicalReleasesByProject(ctx context.Context, projectIDs []string) (map[string]*domain.ProductionRelease, error) {
	out := make(map[string]*domain.ProductionRelease, len(projectIDs))
	valid := make([]string, 0, len(projectIDs))
	for _, id := range projectIDs {
		if isValidUUID(id) {
			valid = append(valid, id)
		}
	}
	if len(valid) == 0 {
		return out, nil
	}
	rows, err := s.db(ctx).Query(ctx, `
		SELECT `+productionReleaseColumns+productionReleaseFrom+`
		WHERE pr.project_id = ANY($1)
		ORDER BY pr.project_id, pr.release_number DESC
	`, valid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		release, err := scanProductionRelease(rows)
		if err != nil {
			return nil, err
		}
		// Descending release numbers put the newest row first per project.
		if _, exists := out[release.ProjectID]; !exists {
			out[release.ProjectID] = release
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
