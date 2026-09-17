package storage

import (
	"context"
	"encoding/json"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #741 PR 1 — the work owns its release.
//
// The latest release authority answers "which release governs the project
// NOW"; it must never answer "which release owns work that was already
// materialized". Every physical writer first asks the second question: the
// materialized executions carry their own release identity
// (PartInstance/ModuleUnitExecution.ProductionRevision, stamped at
// generation from the exact frozen snapshot), and when that identity is a
// release OLDER than the authority there is a discontinuity no command may
// resolve implicitly — continuing P1 versus replacing it with P2 is an
// operational decision this PR deliberately does not automate.
//
// Conservative policy (fail closed, zero mutations):
//
//   - executions all belong to the authority → normal gates apply;
//   - executions all belong to an OLDER release → continuity blocker BEFORE
//     any preparation evidence is consulted (the operator must hear about
//     the discontinuity, not about the new release's pending engineering);
//   - no executions → nothing owns anything yet, normal gates apply;
//   - mixed/ambiguous provenance → the per-target guards in the command
//     closures keep failing closed.
//
// Regeneration (GenerateCanonicalPartExecutions) adds the same split: a
// discontinuity with physical progress blocks even under supervisor force
// (no reconciliation exists to preserve completed operations), a
// discontinuity with an authorized material commitment for the older
// release blocks with its own copy, and a clean discontinuity (untouched,
// uncommitted executions) stays available as preparation.

// executionReleaseOwnership summarizes the release identity of the
// materialized executions.
type executionReleaseOwnership struct {
	// Release is the single distinct ProductionRevision across
	// part_instances/module_units (empty when none or mixed).
	Release string
	// HasExecutions reports whether any execution exists at all.
	HasExecutions bool
}

func executionOwnershipOf(parts []domain.PartInstance, units []domain.ModuleUnitExecution) executionReleaseOwnership {
	distinct := map[string]struct{}{}
	for _, p := range parts {
		if p.ProductionRevision != "" {
			distinct[p.ProductionRevision] = struct{}{}
		}
	}
	for _, u := range units {
		if u.ProductionRevision != "" {
			distinct[u.ProductionRevision] = struct{}{}
		}
	}
	ownership := executionReleaseOwnership{HasExecutions: len(parts) > 0 || len(units) > 0}
	if len(distinct) == 1 {
		for release := range distinct {
			ownership.Release = release
		}
	}
	return ownership
}

// executionsHavePhysicalProgress reports whether any materialized execution
// carries shop-floor progress: a completed/in-progress/rework operation or a
// unit beyond awaiting_parts. Untouched planned executions are preparation.
func executionsHavePhysicalProgress(parts []domain.PartInstance, units []domain.ModuleUnitExecution) bool {
	for _, p := range parts {
		for _, op := range p.RequiredOperations {
			if op.Status == domain.PartOperationStatusCompleted ||
				op.Status == domain.PartOperationStatusInProgress ||
				op.Status == domain.PartOperationStatusRework {
				return true
			}
		}
	}
	for _, u := range units {
		if u.Status != domain.ModuleUnitStatusAwaitingParts {
			return true
		}
	}
	return false
}

// decodeExecutionsRaw best-effort decodes the part_instances/module_units
// JSONB payloads for the continuity guards. A malformed payload yields empty
// slices: the guards treat "no executions" as "nothing to own yet" and the
// per-target release checks inside each command closure keep failing closed
// for anything the guards could not classify.
func decodeExecutionsRaw(partsRaw, unitsRaw []byte) ([]domain.PartInstance, []domain.ModuleUnitExecution) {
	var parts []domain.PartInstance
	var units []domain.ModuleUnitExecution
	if len(partsRaw) > 0 && string(partsRaw) != "null" {
		_ = json.Unmarshal(partsRaw, &parts)
	}
	if len(unitsRaw) > 0 && string(unitsRaw) != "null" {
		_ = json.Unmarshal(unitsRaw, &units)
	}
	return parts, units
}

// guardWorkReleaseContinuity is the shared #741 pre-guard for every writer
// over materialized executions: when the whole execution set belongs to a
// release older than the authority, the continuity blocker fires BEFORE the
// technical guard and the operational gate — the ownership question comes
// first, so the operator never sees the newer release's preparation state
// presented as the reason their in-progress work cannot advance.
func (s *PostgresStore) guardWorkReleaseContinuity(parts []domain.PartInstance, units []domain.ModuleUnitExecution, authority *domain.ResolvedProductionRelease) error {
	if authority == nil || authority.Source != domain.ProductionReleaseAuthorityCanonical {
		// Pre-Digital-Thread compatibility, same boundary as the #740 gate.
		return nil
	}
	ownership := executionOwnershipOf(parts, units)
	if !ownership.HasExecutions || ownership.Release == "" {
		// Nothing materialized, or ambiguous provenance: the per-target
		// release checks inside each command closure keep failing closed.
		return nil
	}
	if ownership.Release != authority.ReleaseID {
		return domain.ErrPhysicalWorkReleaseMismatch
	}
	return nil
}

// guardItemFloorContinuity is the item-level variant: quote-line items carry
// NO release identity of their own, so once the project's materialized
// executions belong to a release other than the authority, an item floor
// write cannot be unambiguously correlated with any release — it fails
// closed instead of guessing (#741 §11: never correlate by position, index,
// date or "latest").
func (s *PostgresStore) guardItemFloorContinuity(parts []domain.PartInstance, units []domain.ModuleUnitExecution, authority *domain.ResolvedProductionRelease) error {
	return s.guardWorkReleaseContinuity(parts, units, authority)
}

// materialCommitmentFor reports whether the project's material planning
// carries an operational commitment (authorized release evidence or
// reservations) pinning the given release.
func materialCommitmentFor(planningRaw []byte, releaseID string) bool {
	if len(planningRaw) == 0 || string(planningRaw) == "null" || releaseID == "" {
		return false
	}
	var planning domain.MaterialPlanning
	if err := json.Unmarshal(planningRaw, &planning); err != nil {
		return false
	}
	if planning.Requirements == nil || planning.Requirements.ReleaseID != releaseID {
		return false
	}
	return planning.Release != nil || len(planning.Reservations) > 0
}

// guardRegenerationContinuity applies the #741 regeneration policy inside
// GenerateCanonicalPartExecutions's locked transaction. The regeneration
// derives from the AUTHORITY; when the executions being replaced belong to
// an older release, the discontinuity policy decides before any force flag
// is consulted.
func (s *PostgresStore) guardRegenerationContinuity(ctx context.Context, q dbtx, projectID string, snap *domain.PartExecutionsSnapshot, authority *domain.ResolvedProductionRelease) error {
	if authority == nil || authority.Source != domain.ProductionReleaseAuthorityCanonical {
		return nil
	}
	ownership := executionOwnershipOf(snap.Parts, snap.Units)
	if ownership.HasExecutions && ownership.Release == "" {
		// Mixed provenance: no automatic reconciliation decides which
		// executions survive. Fail closed.
		return domain.ErrPhysicalWorkReleaseMismatch
	}
	if !ownership.HasExecutions || ownership.Release == authority.ReleaseID {
		return nil
	}
	// Discontinuity: the materialized work belongs to an older release.
	if executionsHavePhysicalProgress(snap.Parts, snap.Units) {
		// Supervisor force is NOT a continuity decision: no reconciliation
		// exists that could preserve completed operations, rework, QC or
		// floor progress, so the replacement never happens implicitly.
		return domain.ErrPhysicalWorkReleaseMismatch
	}
	var planningRaw []byte
	if err := q.QueryRow(ctx, `
		SELECT material_planning FROM projects WHERE id = $1
	`, projectID).Scan(&planningRaw); err != nil {
		return err
	}
	if materialCommitmentFor(planningRaw, ownership.Release) {
		// The older release's materials are committed; moving the work to
		// the new release would orphan that commitment. #680 owns the
		// compensations — this PR only refuses to orphan them.
		return domain.ErrPhysicalWorkMaterialsCommitted
	}
	// Clean discontinuity: untouched, uncommitted executions of the previous
	// release may be replaced by the authority's derived ones (preparation).
	return nil
}
