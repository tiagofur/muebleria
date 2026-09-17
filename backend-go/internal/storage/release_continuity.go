package storage

import (
	"context"
	"encoding/json"
	"fmt"

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
// Conservative policy (fail closed, zero mutations), for canonical projects:
//
//   - no executions at all → normal gates apply (nothing owns anything yet);
//   - single release == authority → normal gates apply;
//   - single release != authority → continuity blocker BEFORE any
//     preparation evidence is consulted (the operator must hear about the
//     discontinuity, not about the new release's pending engineering);
//   - AMBIGUOUS provenance (mixed releases, or executions without a reliable
//     ProductionRevision) → continuity blocker too. The item-level writers
//     (floor-status, floor-scan, activity finish) have NO per-target release
//     check to catch these later — the guard is their only frontier, so it
//     must fail closed. Executions are never repaired or guessed here.
//
// Pre-Digital-Thread projects (legacy authority) keep the explicit
// compatibility boundary of the #740 gate: no release identity to correlate.
//
// Regeneration (GenerateCanonicalPartExecutions) adds the same split: an
// ambiguous or older-release ownership with physical progress blocks even
// under supervisor force (no reconciliation exists to preserve completed
// operations), an older release with an authorized material commitment
// blocks with its own copy, and a clean discontinuity (untouched,
// uncommitted, single older release) stays available as preparation.

// executionReleaseOwnership is the EXPLICIT provenance classification of the
// materialized executions — the three states are never conflated.
type executionReleaseOwnership struct {
	// HasExecutions reports whether any part/unit execution exists at all.
	HasExecutions bool
	// Release is the single distinct non-empty ProductionRevision across
	// part_instances/module_units. Empty unless every execution pins the
	// SAME non-empty release.
	Release string
	// Ambiguous reports unverifiable provenance: executions exist but they
	// pin more than one release, or at least one carries an empty
	// ProductionRevision. Never true when !HasExecutions.
	Ambiguous bool
}

func executionOwnershipOf(parts []domain.PartInstance, units []domain.ModuleUnitExecution) executionReleaseOwnership {
	distinct := map[string]struct{}{}
	unpinned := false
	for _, p := range parts {
		if p.ProductionRevision == "" {
			unpinned = true
			continue
		}
		distinct[p.ProductionRevision] = struct{}{}
	}
	for _, u := range units {
		if u.ProductionRevision == "" {
			unpinned = true
			continue
		}
		distinct[u.ProductionRevision] = struct{}{}
	}
	ownership := executionReleaseOwnership{HasExecutions: len(parts) > 0 || len(units) > 0}
	if len(distinct) == 1 && !unpinned {
		for release := range distinct {
			ownership.Release = release
		}
	}
	ownership.Ambiguous = ownership.HasExecutions && ownership.Release == ""
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

// guardWorkReleaseContinuity is the shared #741 pre-guard for every writer
// over materialized executions. See the policy block at the top of this
// file: ambiguous provenance blocks exactly like an older-release
// discontinuity — the item-level writers have no second, per-target check.
func (s *PostgresStore) guardWorkReleaseContinuity(parts []domain.PartInstance, units []domain.ModuleUnitExecution, authority *domain.ResolvedProductionRelease) error {
	if authority == nil || authority.Source != domain.ProductionReleaseAuthorityCanonical {
		// Pre-Digital-Thread compatibility, same boundary as the #740 gate.
		return nil
	}
	ownership := executionOwnershipOf(parts, units)
	if !ownership.HasExecutions || ownership.Release == authority.ReleaseID {
		return nil
	}
	// Older release OR ambiguous/unverifiable provenance.
	return domain.ErrPhysicalWorkReleaseMismatch
}

// guardItemFloorContinuity is the item-level variant: quote-line items carry
// NO release identity of their own, so this guard is their ONLY frontier —
// it fails closed on ambiguous provenance instead of guessing (#741 §11:
// never correlate by position, index, date or "latest").
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
// an older release — or their provenance cannot be verified — the
// discontinuity policy decides before any force flag is consulted.
func (s *PostgresStore) guardRegenerationContinuity(ctx context.Context, q dbtx, projectID string, snap *domain.PartExecutionsSnapshot, authority *domain.ResolvedProductionRelease) error {
	if authority == nil || authority.Source != domain.ProductionReleaseAuthorityCanonical {
		return nil
	}
	ownership := executionOwnershipOf(snap.Parts, snap.Units)
	if ownership.Ambiguous {
		// Mixed or unpinned provenance: no automatic reconciliation decides
		// which executions survive. Fail closed.
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

// decodeExecutionsRaw decodes the part_instances/module_units JSONB payloads
// for the continuity guards. A NULL/absent payload is the honest "no
// executions" state; a payload that is present but does not decode into the
// execution shape is CORRUPT STATE, never "no executions" — the error
// propagates and the physical writer fails closed. Data is never repaired
// or guessed here.
func decodeExecutionsRaw(partsRaw, unitsRaw []byte) ([]domain.PartInstance, []domain.ModuleUnitExecution, error) {
	var parts []domain.PartInstance
	var units []domain.ModuleUnitExecution
	if len(partsRaw) > 0 && string(partsRaw) != "null" {
		if err := json.Unmarshal(partsRaw, &parts); err != nil {
			return nil, nil, fmt.Errorf("error decoding part_instances for continuity: %w", err)
		}
	}
	if len(unitsRaw) > 0 && string(unitsRaw) != "null" {
		if err := json.Unmarshal(unitsRaw, &units); err != nil {
			return nil, nil, fmt.Errorf("error decoding module_units for continuity: %w", err)
		}
	}
	return parts, units, nil
}
