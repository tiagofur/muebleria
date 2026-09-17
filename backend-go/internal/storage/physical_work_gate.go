package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #740 PR 2: the ONE operational gate every physical writer passes before
// any shop-floor mutation.
//
//	Trabajo físico permitido
//	= ProductionRelease exacto (autoridad vigente)
//	+ Ingeniería COMPLETA para ese release (production_release_engineering)
//	+ materiales AUTORIZADOS para ese MISMO release
//	  (material_planning.Requirements pina release+fingerprint Y Release != nil)
//	+ los gates técnicos existentes (P/R/fingerprint, routing congelado,
//	  secuencia, permisos, QC)
//
// The gate SUMS to the existing guards; it never replaces them. Any absent,
// mismatched or ambiguous evidence fails closed. Pre-Digital-Thread projects
// (no canonical release) keep their legacy OC-022 contract — there is no
// release identity to correlate, and that compatibility never unlocks a
// modern project: any canonical release makes the authority canonical.
//
// Authorization evidence for materials is the OC-054 planning release: a
// regular release ("Material completo") or an explicitly authorized
// exception (override with reason/actor/failing checks) both authorize; both
// keep actor, timestamp and scope auditable. The legacy projects
// .materials_release stamp column is a process-stage projection without
// release identity — the gate never trusts it alone.

// authorizePhysicalWork is the shared gate core. Callers must already hold
// the projects row lock (FOR UPDATE) on their transaction so the engineering
// completion and material authorization commands — which take the same lock —
// serialize with this decision: check and mutation share one frontier and a
// concurrent authority change cannot slip between them.
func (s *PostgresStore) authorizePhysicalWork(ctx context.Context, q dbtx, projectID string, authority *domain.ResolvedProductionRelease) error {
	if authority == nil || authority.Source != domain.ProductionReleaseAuthorityCanonical {
		// Pre-Digital-Thread compatibility, explicitly identified: without a
		// canonical release there is no release identity to correlate and the
		// legacy chain keeps its own contract.
		return nil
	}

	// 1. Engineering completed for the EXACT release. Absent row = pending;
	// in_progress is preparation, not completion. PDF/PTX generation, plan
	// saving and engineeringLog.sentToProductionAt are never evidence here.
	var engStatus string
	err := q.QueryRow(ctx, `
		SELECT status FROM production_release_engineering
		WHERE release_id = $1 AND project_id = $2 AND organization_id = $3
	`, authority.ReleaseID, projectID, OrgFromCtx(ctx)).Scan(&engStatus)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrPhysicalWorkEngineeringPending
		}
		return err
	}
	if engStatus != string(domain.ReleaseEngineeringCompleted) {
		return domain.ErrPhysicalWorkEngineeringPending
	}

	// 2. Materials authorized for the EXACT release: the planning's frozen
	// requirements must pin this release and its manufacturing fingerprint,
	// and carry the explicit release evidence (regular or override).
	var planningRaw []byte
	if err := q.QueryRow(ctx, `
		SELECT material_planning FROM projects WHERE id = $1
	`, projectID).Scan(&planningRaw); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrPhysicalWorkMaterialsPending
		}
		return err
	}
	authorized := false
	if len(planningRaw) > 0 && string(planningRaw) != "null" {
		var planning domain.MaterialPlanning
		if err := json.Unmarshal(planningRaw, &planning); err == nil &&
			planning.Requirements != nil && planning.Release != nil &&
			planning.Requirements.ReleaseID == authority.ReleaseID &&
			planning.Requirements.BomFingerprint == authority.ManufacturingFingerprint {
			authorized = true
		}
	}
	if !authorized {
		return domain.ErrPhysicalWorkMaterialsPending
	}
	return nil
}

// authorizePhysicalWorkTx runs the gate on an explicit transaction (the
// physical writers own one and hold the project row lock).
func (s *PostgresStore) authorizePhysicalWorkTx(ctx context.Context, tx pgx.Tx, projectID string, authority *domain.ResolvedProductionRelease) error {
	return s.authorizePhysicalWork(ctx, tx, projectID, authority)
}

// CheckPhysicalWorkAuthorization evaluates the gate WITHOUT writing: the
// fail-before-mutate preflight for writers whose telemetry record and
// physical side-effect are separate rows (production activity finish). The
// authoritative decision remains the gated write under lock; this preflight
// only avoids recording work the gate would immediately block.
func (s *PostgresStore) CheckPhysicalWorkAuthorization(ctx context.Context, projectID string) error {
	if !isValidUUID(projectID) {
		return fmt.Errorf("invalid project id")
	}
	canonical, err := s.GetLatestProjectProductionRelease(ctx, projectID)
	if err != nil {
		return err
	}
	if canonical == nil {
		// Pre-Digital-Thread compatibility: no release identity to correlate.
		return nil
	}
	return s.authorizePhysicalWork(ctx, s.db(ctx), projectID, domain.ResolvedFromCanonicalRelease(canonical))
}

// ItemFloorAdvance is one gated quote-line item floor write: the target
// status plus the F092 audit event persisted atomically with it.
type ItemFloorAdvance struct {
	ProjectID string
	ItemID    string
	Status    string
	// Event is the audit trail of this transition; nil only records the
	// status (kept for the item touch semantics of the legacy writers).
	Event *domain.FloorStatusEvent
}

// SetProjectItemFloorStatusGated advances one quote-line item's floor status
// through the operational gate (#740 PR 2): the project row is locked FOR
// UPDATE, the release authority resolved, the canonical routing evidence and
// the physical work gate evaluated, and the item status + floor event written
// in ONE transaction. Gate blockers return the domain sentinels with zero
// writes — HTTP callers surface them as 409 with the actionable copy.
func (s *PostgresStore) SetProjectItemFloorStatusGated(ctx context.Context, adv ItemFloorAdvance) error {
	if !isValidItemFloorStatus(adv.Status) {
		return fmt.Errorf("invalid floor status %q", adv.Status)
	}
	tx, err := s.beginTx(ctx)
	if err != nil {
		return fmt.Errorf("error beginning floor status tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var planningRaw, legacyReleaseRaw []byte
	err = tx.QueryRow(ctx, `
		SELECT material_planning, production_release
		FROM projects WHERE id = $1 AND (organization_id = $2 OR sales_organization_id = $2 OR manufacturing_organization_id = $2)
		FOR UPDATE;
	`, adv.ProjectID, OrgFromCtx(ctx)).Scan(&planningRaw, &legacyReleaseRaw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("project not found")
		}
		return fmt.Errorf("error locking project for floor status: %w", err)
	}
	var legacyBlob *domain.LegacyProductionRelease
	if len(legacyReleaseRaw) > 0 && string(legacyReleaseRaw) != "null" {
		var release domain.LegacyProductionRelease
		if err := json.Unmarshal(legacyReleaseRaw, &release); err == nil && release.ID != "" {
			legacyBlob = &release
		}
	}
	authority, err := s.resolveProjectReleaseAuthorityTx(ctx, tx, adv.ProjectID, legacyBlob)
	if err != nil {
		return fmt.Errorf("error resolving release authority: %w", err)
	}
	if authority != nil && authority.Source == domain.ProductionReleaseAuthorityCanonical {
		// Same technical guard as every canonical physical writer, then the
		// operational gate on top of it.
		if err := s.guardCanonicalExecutionRouting(ctx, tx, adv.ProjectID, authority); err != nil {
			return err
		}
		if err := s.authorizePhysicalWorkTx(ctx, tx, adv.ProjectID, authority); err != nil {
			return err
		}
	}

	tag, err := tx.Exec(ctx, `
		UPDATE project_items
		SET floor_status = $1
		WHERE id = $2 AND project_id = $3 AND organization_id = $4;
	`, adv.Status, adv.ItemID, adv.ProjectID, OrgFromCtx(ctx))
	if err != nil {
		return fmt.Errorf("error updating floor status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("project item not found")
	}
	if _, err := tx.Exec(ctx, `
		UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND organization_id = $2;
	`, adv.ProjectID, OrgFromCtx(ctx)); err != nil {
		return fmt.Errorf("error touching project updated_at: %w", err)
	}
	if adv.Event != nil {
		var byUser *string
		if adv.Event.ByUserID != "" {
			byUser = &adv.Event.ByUserID
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO project_item_floor_events
				(id, project_id, item_id, from_status, to_status, at, by_user_id, by_name, source, note, organization_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, ''), $9, NULLIF($10, ''), $11)
			ON CONFLICT (id) DO NOTHING;
		`, adv.Event.ID, adv.Event.ProjectID, adv.Event.ItemID,
			domain.NormalizeItemFloorStatus(adv.Event.From), domain.NormalizeItemFloorStatus(adv.Event.To),
			adv.Event.At, byUser, adv.Event.ByName, adv.Event.Source, adv.Event.Note, OrgFromCtx(ctx)); err != nil {
			return fmt.Errorf("error inserting floor event: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("error committing floor status tx: %w", err)
	}
	return nil
}
