package storage

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"time"

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

// FinishActivityPhysicalCommand finishes one station activity whose sector
// owns a floor status — the finish AND its physical effect run as ONE
// transaction (review fix: the preflight/mutation gap let an authorization
// change between the preflight and the write, leaving a finished activity
// with zero physical effect — a false-progress record).
type FinishActivityPhysicalCommand struct {
	ActivityID  string
	PiecesCount int
	Notes       string
	// ActorID is the finishing actor recorded on the F092 event.
	ActorID string
}

// FinishActivityResult reports what the single transaction did.
type FinishActivityResult struct {
	// Activity carries the finished row (finished_at/pieces/notes/duration).
	Activity domain.ProductionActivity
	// FloorAdvanced reports whether the item's floor status moved in the same
	// commit (false = the item had already reached the sector's status).
	FloorAdvanced bool
	FromStatus    string
	ToStatus      string
}

// FinishProductionActivityWithPhysicalEffect finishes a station activity and,
// when its item has not reached the sector's floor status, advances the
// item's floor status and appends the F092 event — ALL under the project row
// lock with the #740 operational gate in ONE transaction. The activity row is
// re-read and locked (finished_at IS NULL) inside the same transaction; the
// gate is evaluated under the project lock AFTER that, so an authorization
// change that commits first is what this transaction sees. Any error rolls
// back EVERYTHING — no finished activity without its physical effect and no
// physical effect without the gate. Activities whose item already reached
// the target keep finishing without the gate (no physical effect remains).
func (s *PostgresStore) FinishProductionActivityWithPhysicalEffect(ctx context.Context, cmd FinishActivityPhysicalCommand) (*FinishActivityResult, error) {
	tx, err := s.beginTx(ctx)
	if err != nil {
		return nil, fmt.Errorf("error beginning activity finish tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Lock the activity row and re-read it: a concurrent finish fails here,
	// inside the same transaction as everything else.
	activity, err := lockActiveActivityTx(ctx, tx, cmd.ActivityID, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}

	target := domain.TargetStatusForSector(string(activity.Sector))
	if activity.ItemID == "" || target == "" {
		// No physical effect by classification (F095 project×station claim,
		// sectors without a floor status): telemetry keeps its own path and
		// never reaches this method.
		return nil, fmt.Errorf("BAD_REQUEST:la actividad no produce efecto físico; usar el camino de telemetría")
	}

	// Project row lock — the same frontier the engineering/material commands
	// and every physical writer take.
	var planningRaw, legacyReleaseRaw, partsRaw, unitsRaw []byte
	err = tx.QueryRow(ctx, `
		SELECT material_planning, production_release, part_instances, module_units
		FROM projects WHERE id = $1 AND (organization_id = $2 OR sales_organization_id = $2 OR manufacturing_organization_id = $2)
		FOR UPDATE;
	`, activity.ProjectID, OrgFromCtx(ctx)).Scan(&planningRaw, &legacyReleaseRaw, &partsRaw, &unitsRaw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("project not found")
		}
		return nil, fmt.Errorf("error locking project for activity finish: %w", err)
	}

	var beforeStatus string
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(floor_status, 'pending') FROM project_items
		WHERE id = $1 AND project_id = $2 AND organization_id = $3
	`, activity.ItemID, activity.ProjectID, OrgFromCtx(ctx)).Scan(&beforeStatus); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("NOT_FOUND:ítem no encontrado en esta obra: %s", activity.ItemID)
		}
		return nil, fmt.Errorf("error reading item floor status: %w", err)
	}
	before := domain.NormalizeItemFloorStatus(beforeStatus)

	result := &FinishActivityResult{Activity: *activity, FromStatus: before, ToStatus: before}
	needsAdvance := before != target && domain.FloorStatusRank(before) < domain.FloorStatusRank(target)
	if needsAdvance {
		var legacyBlob *domain.LegacyProductionRelease
		if len(legacyReleaseRaw) > 0 && string(legacyReleaseRaw) != "null" {
			var release domain.LegacyProductionRelease
			if err := json.Unmarshal(legacyReleaseRaw, &release); err == nil && release.ID != "" {
				legacyBlob = &release
			}
		}
		authority, err := s.resolveProjectReleaseAuthorityTx(ctx, tx, activity.ProjectID, legacyBlob)
		if err != nil {
			return nil, fmt.Errorf("error resolving release authority: %w", err)
		}
		if authority != nil && authority.Source == domain.ProductionReleaseAuthorityCanonical {
			// #741: the activity's floor effect belongs to an item without
			// release identity — if the materialized executions belong to a
			// release older than the authority, the continuity blocker fires
			// before any preparation evidence is consulted. Ambiguous
			// provenance or a payload that fails to decode also fail CLOSED
			// (this guard is the item writers' only frontier).
			parts, units, err := decodeExecutionsRaw(partsRaw, unitsRaw)
			if err != nil {
				return nil, err
			}
			if err := s.guardItemFloorContinuity(parts, units, authority); err != nil {
				return nil, err
			}
			if err := s.guardCanonicalExecutionRouting(ctx, tx, activity.ProjectID, authority); err != nil {
				return nil, err
			}
			if err := s.authorizePhysicalWorkTx(ctx, tx, activity.ProjectID, authority); err != nil {
				return nil, err
			}
		}

		// Everything below shares this transaction: activity finish + floor
		// status + F092 — one commit or one rollback.
		if _, err := tx.Exec(ctx, `
			UPDATE project_items SET floor_status = $1
			WHERE id = $2 AND project_id = $3 AND organization_id = $4;
		`, target, activity.ItemID, activity.ProjectID, OrgFromCtx(ctx)); err != nil {
			return nil, fmt.Errorf("error advancing floor status: %w", err)
		}
		note := "fin de actividad en " + string(activity.Sector)
		if domain.FloorStatusRank(target)-domain.FloorStatusRank(before) != 1 {
			note = domain.FloorEventJumpNote(note, before, target)
		}
		var byUser *string
		if cmd.ActorID != "" {
			byUser = &cmd.ActorID
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO project_item_floor_events
				(id, project_id, item_id, from_status, to_status, at, by_user_id, by_name, source, note, organization_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, ''), $9, NULLIF($10, ''), $11)
			ON CONFLICT (id) DO NOTHING;
		`, newStorageFloorEventID(), activity.ProjectID, activity.ItemID, before, target,
			time.Now().UTC(), byUser, activity.OperatorName, domain.FloorEventSourceActivity, note, OrgFromCtx(ctx)); err != nil {
			return nil, fmt.Errorf("error inserting floor event: %w", err)
		}
		result.FloorAdvanced = true
		result.ToStatus = target
	}

	now := time.Now().UTC()
	if _, err := tx.Exec(ctx, `
		UPDATE production_activities
		SET finished_at = $1, pieces_count = $2, notes = $3, type = 'finish'
		WHERE id = $4 AND finished_at IS NULL AND organization_id = $5
	`, now, cmd.PiecesCount, cmd.Notes, cmd.ActivityID, OrgFromCtx(ctx)); err != nil {
		return nil, fmt.Errorf("error finishing activity: %w", err)
	}
	result.Activity.FinishedAt = &now
	result.Activity.PiecesCount = cmd.PiecesCount
	result.Activity.Notes = cmd.Notes
	if result.Activity.StartedAt != nil {
		result.Activity.DurationMillis = now.Sub(*result.Activity.StartedAt).Milliseconds()
	}

	if _, err := tx.Exec(ctx, `
		UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND organization_id = $2;
	`, activity.ProjectID, OrgFromCtx(ctx)); err != nil {
		return nil, fmt.Errorf("error touching project updated_at: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("error committing activity finish tx: %w", err)
	}
	return result, nil
}

// lockActiveActivityTx locks and re-reads one unfinished activity on the
// transaction (the handler's earlier read is advisory only).
func lockActiveActivityTx(ctx context.Context, tx pgx.Tx, activityID, orgID string) (*domain.ProductionActivity, error) {
	var act domain.ProductionActivity
	err := tx.QueryRow(ctx, `
		SELECT id, project_id, project_name, COALESCE(item_id, ''), module_code, module_name,
			sector, type, operator_id, operator_name, machine_id, machine_name,
			started_at, finished_at, duration_ms, pieces_count, notes, status_before, created_at
		FROM production_activities
		WHERE id = $1 AND organization_id = $2
		FOR UPDATE;
	`, activityID, orgID).Scan(
		&act.ID, &act.ProjectID, &act.ProjectName, &act.ItemID, &act.ModuleCode, &act.ModuleName,
		&act.Sector, &act.Type, &act.OperatorID, &act.OperatorName, &act.MachineID, &act.MachineName,
		&act.StartedAt, &act.FinishedAt, &act.DurationMillis, &act.PiecesCount, &act.Notes, &act.StatusBefore, &act.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("NOT_FOUND:actividad no encontrada")
		}
		return nil, fmt.Errorf("error locking activity: %w", err)
	}
	if act.FinishedAt != nil {
		return nil, fmt.Errorf("CONFLICT:la actividad ya fue finalizada")
	}
	return &act, nil
}

// newStorageFloorEventID mints an F092 event id (UUID format, matching the
// api-side generator) — storage-authored transitions need server ids too.
func newStorageFloorEventID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("fe-%d", time.Now().UnixNano())
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
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

	var planningRaw, legacyReleaseRaw, partsRaw, unitsRaw []byte
	err = tx.QueryRow(ctx, `
		SELECT material_planning, production_release, part_instances, module_units
		FROM projects WHERE id = $1 AND (organization_id = $2 OR sales_organization_id = $2 OR manufacturing_organization_id = $2)
		FOR UPDATE;
	`, adv.ProjectID, OrgFromCtx(ctx)).Scan(&planningRaw, &legacyReleaseRaw, &partsRaw, &unitsRaw)
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
		// #741: quote-line items carry no release identity — the floor write
		// fails closed when the materialized executions belong to a release
		// older than the authority (no correlation is invented), and ALSO on
		// ambiguous provenance or a payload that fails to decode: this guard
		// is the item writers' only frontier, corrupt state never becomes
		// "no executions".
		parts, units, err := decodeExecutionsRaw(partsRaw, unitsRaw)
		if err != nil {
			return err
		}
		if err := s.guardItemFloorContinuity(parts, units, authority); err != nil {
			return err
		}
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
