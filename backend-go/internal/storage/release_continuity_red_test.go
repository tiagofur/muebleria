package storage_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #741 PR 1 — the conservative continuity policy over real PostgreSQL +
// real HTTP.
//
// This file was born as the RED documenting the behavior BEFORE the fix
// (scenario shape preserved so before/after stays comparable):
//
//	advance/assembly/floor-status/rework of P1 work under a P2 authority
//	  → 409 "Ingeniería pendiente" (P2's evidence — the discontinuity was
//	    never explained to the operator); blocked with zero mutations, but
//	    the ownership question came AFTER the preparation questions.
//	PUT part-executions force=true → 200: the P1 executions (completed cut
//	  included) were silently REPLACED by P2-derived ones.
//	regeneration without progress but with P1's authorized materials → 200:
//	  work moved to P2 leaving P1's commitment orphaned.
//
// Since the fix every writer over materialized work first asks WHICH release
// owns the work (storage/release_continuity.go): a single-ownership
// execution set belonging to a release older than the authority gets the
// continuity blocker (409, actionable copy, zero mutations) BEFORE any
// technical guard or preparation evidence; the force regeneration blocks on
// the discontinuity (progress) or on the orphaned material commitment; a
// clean discontinuity (untouched, uncommitted) stays available as
// preparation; P1's history stays readable with zero mutations.

// continuityCreateP2 publishes a revision with a real manufacturing change
// (both units 600 mm → 650 mm), accepts the matching quote Q4, approves the
// revision and creates P2 from the exact (R4, Q4) pair. Returns the new
// release id + fingerprint.
func continuityCreateP2(t *testing.T, gs *gateSetup, keyPrefix string) (p2ID, p2Fingerprint string) {
	t.Helper()
	actorA := fiActorA()
	err := releaseTx(t, gs.fx.store, actorA, func(ctx context.Context) error {
		workingItem := func(fiID string) storage.UpdateDesignWorkingCopyItemCommand {
			return storage.UpdateDesignWorkingCopyItemCommand{
				FurnitureInstanceID:   fiID,
				FurnitureDefinitionID: fiModuleA,
				Parameters:            map[string]any{"widthMm": 650.0, "heightMm": 720.0, "depthMm": 560.0},
				MaterialChoices:       map[string]string{"BODY": releaseMaterial},
				Transform:             domain.Transform3D{TranslationMm: [3]float64{100, 0, 0}},
			}
		}
		if _, err := UpdateWorkingCopyCurrent(ctx, gs.fx.store, storage.UpdateDesignWorkingCopyCommand{
			DesignID:    gs.fx.designID,
			SourceType:  domain.DesignRevisionSourceManual,
			Items:       []storage.UpdateDesignWorkingCopyItemCommand{workingItem(gs.fx.fiA), workingItem(gs.fx.fiB)},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}
		quoteItem := func(fiID string) storage.CreateQuoteRevisionItemCommand {
			return storage.CreateQuoteRevisionItemCommand{
				FurnitureInstanceID:   fiID,
				FurnitureDefinitionID: fiModuleA,
				Parameters:            map[string]any{"widthMm": 650.0, "heightMm": 720.0, "depthMm": 560.0},
				MaterialChoices:       map[string]string{"BODY": releaseMaterial},
				LifecycleStatus:       "active",
			}
		}
		q4, err := createPublishedFixtureQuoteRevision(ctx, gs.fx.store, storage.CreateQuoteRevisionCommand{
			ProjectID:      gs.fx.projectID,
			Notes:          "Q4 (650mm)",
			BaseRevisionID: gs.fx.quoteQ3,
			Items:          []storage.CreateQuoteRevisionItemCommand{quoteItem(gs.fx.fiA), quoteItem(gs.fx.fiB)},
		})
		if err != nil {
			return err
		}
		if _, err := gs.fx.store.UpdateQuoteRevisionStatus(ctx, storage.UpdateQuoteRevisionStatusCommand{
			QuoteRevisionID: q4.ID,
			Status:          "accepted",
		}); err != nil {
			return err
		}
		rev, err := gs.fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:       gs.fx.designID,
			BaseRevisionID: gs.fx.revR3,
			SourceType:     domain.DesignRevisionSourceManual,
			ActorUserID:    rlsUserA,
		})
		if err != nil {
			return err
		}
		if _, err := gs.fx.store.ApproveDesignRevision(ctx, storage.ApproveDesignRevisionCommand{
			DesignID:         gs.fx.designID,
			DesignRevisionID: rev.ID,
			ActorUserID:      rlsUserA,
		}); err != nil {
			return err
		}
		p2, err := gs.fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        gs.fx.projectID,
			DesignRevisionID: rev.ID,
			QuoteRevisionID:  q4.ID,
			ActorUserID:      rlsUserA,
			RequestID:        "req-741-" + keyPrefix + "-p2",
		})
		if err != nil {
			return err
		}
		p2ID = p2.Release.ID
		p2Fingerprint = p2.Release.ManufacturingFingerprint
		return nil
	})
	if err != nil {
		t.Fatalf("create P2: %v", err)
	}
	if p2Fingerprint == gs.p1.Release.ManufacturingFingerprint {
		t.Fatalf("P2 must differ in manufacturing content from P1 (fingerprints equal: %s)", p2Fingerprint)
	}
	return p2ID, p2Fingerprint
}

// executionRevisions returns the set of distinct ProductionRevision values
// across the persisted part_instances/module_units.
func executionRevisions(t *testing.T, gs *gateSetup) map[string]int {
	t.Helper()
	out := map[string]int{}
	rows, err := gs.fx.admin.Query(gs.ctx, `
		SELECT elem->>'production_revision' FROM projects, jsonb_array_elements(part_instances) AS pi(elem)
		WHERE projects.id = $1
		UNION ALL
		SELECT elem->>'production_revision' FROM projects, jsonb_array_elements(module_units) AS mu(elem)
		WHERE projects.id = $1`, gs.fx.projectID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var rev *string
		if err := rows.Scan(&rev); err != nil {
			t.Fatal(err)
		}
		if rev != nil && *rev != "" {
			out[*rev]++
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// continuityBlocked asserts the 409 continuity blocker with its actionable
// copy (no technical ids in the main message).
func continuityBlocked(t *testing.T, gotCode int, body, where string) {
	t.Helper()
	if gotCode != http.StatusConflict {
		t.Fatalf("%s: expected 409 continuity blocker, got=%d body=%s", where, gotCode, body)
	}
	if !strings.Contains(body, "liberación anterior") || !strings.Contains(body, "continuidad") {
		t.Fatalf("%s: blocker must explain the newer-release discontinuity, got=%s", where, body)
	}
}

// The main scenario: P1 progressing physically, P2 appears, every dangerous
// command fails closed with the continuity explanation and ZERO mutations.
// This also covers §13 race 3 sequentially: P2 exists → advance P1 must not
// use P2's engineering/materials for P1 work (nothing of P2 is consumed and
// nothing of P1 is retargeted).
func TestReleaseContinuity_P2WithP1WorkInProgress(t *testing.T) {
	gs := gateSetupFixture(t)
	// P1 fully prepared: Engineering completed + materials authorized, and
	// one piece physically advanced (cut completed, floor event recorded).
	gs.completeEngineering(t, gs.p1.Release.ID, "red741")
	gs.seedMaterialsAuthorization(t, gs.p1.Release.ID, gs.p1.Release.ManufacturingFingerprint, false)
	if rr := gs.advance(`{"operation_type":"cut","operator_name":"Op"}`); rr.Code != 200 {
		t.Fatalf("P1 authorized advance=%d %s", rr.Code, rr.Body.String())
	}

	// Execution identity is P1's: every part/unit pins the exact release.
	revisions := executionRevisions(t, gs)
	if len(revisions) != 1 || revisions[gs.p1.Release.ID] == 0 {
		t.Fatalf("prestate: all executions must pin P1 %s, got %v", gs.p1.Release.ID, revisions)
	}

	p2ID, p2Fingerprint := continuityCreateP2(t, gs, "main")

	// P2 is the latest authority and is born operationally clean: no durable
	// engineering row (pending), and the material planning still belongs to
	// P1 (P2 appropriated nothing).
	var authorityID string
	if err := gs.fx.admin.QueryRow(gs.ctx, `
		SELECT id FROM production_releases WHERE project_id = $1
		ORDER BY release_number DESC LIMIT 1`, gs.fx.projectID).Scan(&authorityID); err != nil {
		t.Fatal(err)
	}
	if authorityID != p2ID {
		t.Fatalf("P2 (%s) must be the latest authority, got %s", p2ID, authorityID)
	}
	var p2EngineeringRows int
	if err := gs.fx.admin.QueryRow(gs.ctx, `
		SELECT COUNT(*) FROM production_release_engineering WHERE release_id = $1`, p2ID).
		Scan(&p2EngineeringRows); err != nil {
		t.Fatal(err)
	}
	if p2EngineeringRows != 0 {
		t.Fatalf("P2 must be born engineering-pending (0 rows), got %d", p2EngineeringRows)
	}
	var planningRelease, planningRequirements string
	if err := gs.fx.admin.QueryRow(gs.ctx, `
		SELECT material_planning->'requirements'->>'release_id',
		       material_planning->'requirements'->>'bom_fingerprint'
		FROM projects WHERE id = $1`, gs.fx.projectID).Scan(&planningRelease, &planningRequirements); err != nil {
		t.Fatal(err)
	}
	if planningRelease != gs.p1.Release.ID || planningRequirements != gs.p1.Release.ManufacturingFingerprint {
		t.Fatalf("material planning must remain P1's commitment, got release=%s fp=%s", planningRelease, planningRequirements)
	}

	// ── (a) advance part P1 → 409 continuity, zero mutations ──────────────
	before := gs.counts(t)
	rr := gs.advance(`{"operation_type":"cnc","operator_name":"Op"}`)
	continuityBlocked(t, rr.Code, rr.Body.String(), "advance part")
	gs.gateAssertZeroMutations(t, before, "advance part")

	// ── (b) unit advance P1 → 409 continuity, zero mutations ─────────────
	before = gs.counts(t)
	rr = gs.call(http.MethodPost, "/api/projects/"+gs.fx.projectID+"/units/"+gs.unit.ID+"/advance",
		gs.h.tokenA, `{"target_status":"assembly"}`, "", "")
	continuityBlocked(t, rr.Code, rr.Body.String(), "unit advance")
	gs.gateAssertZeroMutations(t, before, "unit advance")

	// ── (c) item floor-status → 409 continuity (items carry no release
	// identity; nothing is correlated by position/index/latest) ───────────
	before = gs.counts(t)
	rr = gs.call(http.MethodPatch, "/api/projects/"+gs.fx.projectID+"/items/"+gs.itemID+"/floor-status",
		gs.h.tokenA, `{"status":"cut"}`, "", "")
	continuityBlocked(t, rr.Code, rr.Body.String(), "floor-status")
	gs.gateAssertZeroMutations(t, before, "floor-status")

	// ── (c2) floor-scan → same continuity blocker ─────────────────────────
	before = gs.counts(t)
	rr = gs.call(http.MethodPost, "/api/projects/"+gs.fx.projectID+"/floor-scan",
		gs.h.tokenA, `{"item_id":"`+gs.itemID+`","advance":true}`, "", "")
	continuityBlocked(t, rr.Code, rr.Body.String(), "floor-scan")
	gs.gateAssertZeroMutations(t, before, "floor-scan")

	// ── (d) part rework P1 → 409 continuity, zero mutations ───────────────
	before = gs.counts(t)
	rr = gs.call(http.MethodPost, "/api/projects/"+gs.fx.projectID+"/parts/"+gs.part.ID+"/rework",
		gs.h.tokenA, `{"action":"rework","reason":"continuity repro"}`, "", "")
	continuityBlocked(t, rr.Code, rr.Body.String(), "part rework")
	gs.gateAssertZeroMutations(t, before, "part rework")

	// ── (d2) quality rework on the P1 piece → 409 continuity ─────────────
	before = gs.counts(t)
	rr = gs.call(http.MethodPost, "/api/projects/"+gs.fx.projectID+"/quality/rework",
		gs.h.tokenA, `{"part_instance_id":"`+gs.part.ID+`","action":"rework","reason":"continuity repro"}`, "", "")
	continuityBlocked(t, rr.Code, rr.Body.String(), "quality rework")
	gs.gateAssertZeroMutations(t, before, "quality rework")

	// ── (e) supervisor force regeneration → 409 continuity, and the P1
	// work survives COMPLETE: same part ids, same completed cut, same
	// release pinning. Force is not a continuity decision.
	before = gs.counts(t)
	rr = gs.call(http.MethodPut, "/api/projects/"+gs.fx.projectID+"/part-executions",
		gs.h.tokenA, `{"force":true}`, "", "force-741-main")
	continuityBlocked(t, rr.Code, rr.Body.String(), "force regeneration")
	gs.gateAssertZeroMutations(t, before, "force regeneration")
	revisions = executionRevisions(t, gs)
	if len(revisions) != 1 || revisions[gs.p1.Release.ID] == 0 {
		t.Fatalf("force regeneration: executions must still pin P1 only, got %v", revisions)
	}
	var advancedOpStatus string
	if err := gs.fx.admin.QueryRow(gs.ctx, `
		SELECT pi.elem->'required_operations'->0->>'status'
		FROM projects, jsonb_array_elements(part_instances) AS pi(elem)
		WHERE projects.id = $1 AND pi.elem->>'id' = $2`, gs.fx.projectID, gs.part.ID).
		Scan(&advancedOpStatus); err != nil {
		t.Fatal(err)
	}
	if advancedOpStatus != string(domain.PartOperationStatusCompleted) {
		t.Fatalf("force regeneration: the completed cut must survive, got %q", advancedOpStatus)
	}
	_ = p2Fingerprint
}

// Materials-committed discontinuity: P1 executions NEVER advanced, but P1's
// materials are authorized (operational commitment). The regeneration under
// P2 blocks with the commitment copy — P1's authorization is never orphaned
// and the untouched executions stay P1's.
func TestReleaseContinuity_RegenerateWithMaterialsCommitted(t *testing.T) {
	gs := gateSetupFixture(t)
	gs.completeEngineering(t, gs.p1.Release.ID, "red741mc")
	gs.seedMaterialsAuthorization(t, gs.p1.Release.ID, gs.p1.Release.ManufacturingFingerprint, false)
	// NO physical advance: executions remain planned.

	p2ID, _ := continuityCreateP2(t, gs, "mc")

	before := gs.counts(t)
	rr := gs.call(http.MethodPut, "/api/projects"+"/"+gs.fx.projectID+"/part-executions",
		gs.h.tokenA, `{}`, "", "mc-741")
	if rr.Code != http.StatusConflict || !strings.Contains(rr.Body.String(), "materiales comprometidos") {
		t.Fatalf("regeneration with committed materials: expected 409 commitment blocker, got=%d %s", rr.Code, rr.Body.String())
	}
	gs.gateAssertZeroMutations(t, before, "regeneration with committed materials")
	revisions := executionRevisions(t, gs)
	if len(revisions) != 1 || revisions[gs.p1.Release.ID] == 0 {
		t.Fatalf("planned executions must stay P1's, got %v (P2=%s)", revisions, p2ID)
	}
	var planningRelease string
	if err := gs.fx.admin.QueryRow(gs.ctx, `
		SELECT material_planning->'requirements'->>'release_id' FROM projects WHERE id = $1`,
		gs.fx.projectID).Scan(&planningRelease); err != nil {
		t.Fatal(err)
	}
	if planningRelease != gs.p1.Release.ID {
		t.Fatalf("planning must keep pinning P1, got %s", planningRelease)
	}
}

// Clean discontinuity (the allowed path, must survive the fix): P1
// executions untouched, NO material commitment for P1 → regenerating under
// P2 replaces the planned executions with P2's. Preparation, not retarget:
// nothing of value is lost.
func TestReleaseContinuity_RegenerateCleanDiscontinuityStaysAllowed(t *testing.T) {
	gs := gateSetupFixture(t)
	// Engineering completed but materials NEVER authorized (no commitment),
	// no physical progress.
	gs.completeEngineering(t, gs.p1.Release.ID, "clean741")

	p2ID, _ := continuityCreateP2(t, gs, "clean")

	rr := gs.call(http.MethodPut, "/api/projects/"+gs.fx.projectID+"/part-executions",
		gs.h.tokenA, `{}`, "", "clean-741")
	if rr.Code != 200 {
		t.Fatalf("clean regeneration must stay allowed, got=%d %s", rr.Code, rr.Body.String())
	}
	revisions := executionRevisions(t, gs)
	if len(revisions) != 1 || revisions[p2ID] == 0 {
		t.Fatalf("clean regeneration must derive P2 executions, got %v", revisions)
	}
	// The handles now point at P2-owned executions (counts() tracks them).
	var regenerated struct {
		Parts []domain.PartInstance        `json:"part_instances"`
		Units []domain.ModuleUnitExecution `json:"module_units"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &regenerated); err != nil || len(regenerated.Parts) == 0 {
		t.Fatalf("clean regeneration must return the authoritative executions: %v (%s)", err, rr.Body.String())
	}
	gs.part = regenerated.Parts[0]
	gs.unit = regenerated.Units[0]
	// And after the clean regeneration the work belongs to P2: with P2's
	// engineering still pending, the normal #740 gate copy comes back (the
	// continuity discontinuity is resolved — the executions were replaced
	// while still untouched).
	before := gs.counts(t)
	var partID string
	if err := gs.fx.admin.QueryRow(gs.ctx, `
		SELECT pi.elem->>'id' FROM projects, jsonb_array_elements(part_instances) AS pi(elem)
		WHERE projects.id = $1 LIMIT 1`, gs.fx.projectID).Scan(&partID); err != nil {
		t.Fatal(err)
	}
	rr = gs.call(http.MethodPost, "/api/projects/"+gs.fx.projectID+"/parts/"+partID+"/advance",
		gs.h.tokenA, `{"operation_type":"cut"}`, "", "")
	if rr.Code != http.StatusConflict || !strings.Contains(rr.Body.String(), "Ingeniería pendiente") {
		t.Fatalf("P2-owned work under P2 authority: expected the honest P2 engineering-pending copy, got=%d %s", rr.Code, rr.Body.String())
	}
	gs.gateAssertZeroMutations(t, before, "advance after clean regeneration")
}

// Historical readability of P1 after P2 exists: list + exact release read +
// frozen cutting demand stay available and mutate nothing.
func TestReleaseContinuity_P1HistoryReadableWithoutMutation(t *testing.T) {
	gs := gateSetupFixture(t)
	gs.completeEngineering(t, gs.p1.Release.ID, "hist741")
	gs.seedMaterialsAuthorization(t, gs.p1.Release.ID, gs.p1.Release.ManufacturingFingerprint, false)
	if rr := gs.advance(`{"operation_type":"cut","operator_name":"Op"}`); rr.Code != 200 {
		t.Fatalf("P1 advance=%d %s", rr.Code, rr.Body.String())
	}
	continuityCreateP2(t, gs, "hist")

	before := gs.counts(t)

	rr := gs.call(http.MethodGet, "/api/projects/"+gs.fx.projectID+"/production-releases", gs.h.tokenA, "", "", "")
	if rr.Code != 200 {
		t.Fatalf("releases list=%d %s", rr.Code, rr.Body.String())
	}
	var list []domain.ProductionRelease
	if err := json.Unmarshal(rr.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("both P1 and P2 must be listed, got %d", len(list))
	}

	rr = gs.call(http.MethodGet,
		"/api/projects/"+gs.fx.projectID+"/production-releases/"+gs.p1.Release.ID+"/cutting-demand",
		gs.h.tokenA, "", "", "")
	if rr.Code != 200 {
		t.Fatalf("P1 cutting demand=%d %s", rr.Code, rr.Body.String())
	}

	gs.gateAssertZeroMutations(t, before, "historical reads")
}

// §13 race 1: a physical item write starts while P2 is created
// concurrently. Both commands serialize on the projects row lock: the write
// either commits entirely as P1-governed work (it resolved the authority
// before P2 existed) or fails closed with the continuity blocker after P2
// committed. It can NEVER start under P1 and land as P2.
func TestReleaseContinuity_RaceAdvanceVsP2Creation(t *testing.T) {
	gs := gateSetupFixture(t)
	gs.completeEngineering(t, gs.p1.Release.ID, "race741")
	gs.seedMaterialsAuthorization(t, gs.p1.Release.ID, gs.p1.Release.ManufacturingFingerprint, false)
	// One P1 piece already advanced: the project has in-progress work the
	// racing item write would extend.
	if rr := gs.advance(`{"operation_type":"cut","operator_name":"Op"}`); rr.Code != 200 {
		t.Fatalf("P1 first advance=%d %s", rr.Code, rr.Body.String())
	}

	var wg sync.WaitGroup
	writeRR := make([]*httptest.ResponseRecorder, 1)
	wg.Add(2)
	go func() {
		defer wg.Done()
		writeRR[0] = gs.call(http.MethodPatch, "/api/projects/"+gs.fx.projectID+"/items/"+gs.itemID+"/floor-status",
			gs.h.tokenA, `{"status":"cut"}`, "", "")
	}()
	go func() {
		defer wg.Done()
		continuityCreateP2(t, gs, "race")
	}()
	wg.Wait()

	rr := writeRR[0]
	switch rr.Code {
	case 200:
		// The write won the lock under the P1 authority: its effect is P1
		// work — the item advanced exactly one status with its F092 event.
		var floorStatus string
		if err := gs.fx.admin.QueryRow(gs.ctx, `
			SELECT floor_status FROM project_items WHERE id = $1`, gs.itemID).Scan(&floorStatus); err != nil {
			t.Fatal(err)
		}
		if floorStatus != "cut" {
			t.Fatalf("won floor write must advance the item to cut, got %q", floorStatus)
		}
	case 409:
		if !strings.Contains(rr.Body.String(), "liberación anterior") {
			t.Fatalf("lost floor write must fail with the continuity blocker, got=%s", rr.Body.String())
		}
		var floorStatus string
		if err := gs.fx.admin.QueryRow(gs.ctx, `
			SELECT COALESCE(floor_status, 'pending') FROM project_items WHERE id = $1`, gs.itemID).Scan(&floorStatus); err != nil {
			t.Fatal(err)
		}
		if floorStatus != "pending" {
			t.Fatalf("blocked floor write must leave the item pending, got %q", floorStatus)
		}
	default:
		t.Fatalf("unexpected race outcome=%d %s", rr.Code, rr.Body.String())
	}
	// P2 exists regardless, and the executions never crossed releases.
	revisions := executionRevisions(t, gs)
	if len(revisions) != 1 || revisions[gs.p1.Release.ID] == 0 {
		t.Fatalf("executions must stay P1-pinned through the race, got %v", revisions)
	}
}

// §13 race 2: the force regeneration starts while P2 is created
// concurrently. The regeneration resolves its authority INSIDE the project
// lock: it either runs under P1 (the in-release supervised force contract —
// pre-existing since #577/#740) or, once P2 committed, blocks on the
// continuity discontinuity. The executions can never land P2-stamped while
// P1 physical progress existed.
func TestReleaseContinuity_RaceRegenerateVsP2Creation(t *testing.T) {
	gs := gateSetupFixture(t)
	gs.completeEngineering(t, gs.p1.Release.ID, "race2gen")
	gs.seedMaterialsAuthorization(t, gs.p1.Release.ID, gs.p1.Release.ManufacturingFingerprint, false)
	if rr := gs.advance(`{"operation_type":"cut","operator_name":"Op"}`); rr.Code != 200 {
		t.Fatalf("P1 advance=%d %s", rr.Code, rr.Body.String())
	}

	var wg sync.WaitGroup
	regenRR := make([]*httptest.ResponseRecorder, 1)
	wg.Add(2)
	go func() {
		defer wg.Done()
		regenRR[0] = gs.call(http.MethodPut, "/api/projects/"+gs.fx.projectID+"/part-executions",
			gs.h.tokenA, `{"force":true}`, "", "race2-741")
	}()
	go func() {
		defer wg.Done()
		continuityCreateP2(t, gs, "race2")
	}()
	wg.Wait()

	rr := regenRR[0]
	switch rr.Code {
	case 200:
		// In-release supervised regeneration under the P1 authority it saw:
		// every derived execution pins P1 (never P2 content).
		revisions := executionRevisions(t, gs)
		if len(revisions) != 1 || revisions[gs.p1.Release.ID] == 0 {
			t.Fatalf("in-release regeneration must derive P1 executions, got %v", revisions)
		}
	case 409:
		if !strings.Contains(rr.Body.String(), "liberación anterior") {
			t.Fatalf("regeneration after P2 committed must block on continuity, got=%s", rr.Body.String())
		}
		// Zero loss: the completed cut survives untouched.
		var opStatus string
		if err := gs.fx.admin.QueryRow(gs.ctx, `
			SELECT pi.elem->'required_operations'->0->>'status'
			FROM projects, jsonb_array_elements(part_instances) AS pi(elem)
			WHERE projects.id = $1 AND pi.elem->>'id' = $2`, gs.fx.projectID, gs.part.ID).
			Scan(&opStatus); err != nil {
			t.Fatal(err)
		}
		if opStatus != string(domain.PartOperationStatusCompleted) {
			t.Fatalf("blocked regeneration must preserve the completed cut, got %q", opStatus)
		}
	default:
		t.Fatalf("unexpected race outcome=%d %s", rr.Code, rr.Body.String())
	}
	revisions := executionRevisions(t, gs)
	if len(revisions) != 1 || revisions[gs.p1.Release.ID] == 0 {
		t.Fatalf("executions must never mix or cross releases in the race, got %v", revisions)
	}
}

// ── Review correction (P0): ambiguous provenance must fail CLOSED ──────────
//
// The first version of the guard conflated "no executions" with "mixed or
// unpinned provenance" (both left Release empty and returned nil). The
// item-level writers (floor-status, floor-scan, activity finish) have NO
// per-target ProductionRevision check — that conflation was their fail-open
// hole. These regressions pin the corrected policy: canonical project +
// executions whose provenance cannot be verified → continuity blocker with
// zero mutations, and a payload that does not decode NEVER becomes "no
// executions".

// continuityRewritePartRevisions rewrites the persisted part_instances with
// the given production_revision values (one per part; "" strips the pin).
func continuityRewritePartRevisions(t *testing.T, gs *gateSetup, revisions []string) {
	t.Helper()
	tag, err := gs.fx.admin.Exec(gs.ctx, `
		UPDATE projects SET part_instances = (
			SELECT jsonb_agg(
				CASE WHEN revs.ord IS NOT NULL
				     THEN pi.elem || jsonb_build_object('production_revision', NULLIF(revs.revision, ''))
				     ELSE pi.elem END
				ORDER BY pi.ord)
			FROM jsonb_array_elements(part_instances) WITH ORDINALITY AS pi(elem, ord)
			LEFT JOIN unnest($2::text[]) WITH ORDINALITY AS revs(revision, ord)
				ON revs.ord = pi.ord
		) WHERE id = $1`,
		gs.fx.projectID, revisions)
	if err != nil || tag.RowsAffected() == 0 {
		t.Fatalf("rewrite part revisions %v: %v", revisions, err)
	}
}

// Mixed P1/P2 provenance: every item-level physical writer blocks with the
// continuity copy and leaves zero mutations (floor status, 0 F092, activity
// unfinished).
func TestReleaseContinuity_MixedProvenanceBlocksItemWriters(t *testing.T) {
	gs := gateSetupFixture(t)
	gs.completeEngineering(t, gs.p1.Release.ID, "mix741")
	gs.seedMaterialsAuthorization(t, gs.p1.Release.ID, gs.p1.Release.ManufacturingFingerprint, false)
	if rr := gs.advance(`{"operation_type":"cut","operator_name":"Op"}`); rr.Code != 200 {
		t.Fatalf("P1 advance=%d %s", rr.Code, rr.Body.String())
	}
	p2ID, _ := continuityCreateP2(t, gs, "mix")

	// Part 1 re-pinned to P2 while the rest stay P1: mixed provenance.
	continuityRewritePartRevisions(t, gs, []string{p2ID})

	// floor-status PATCH: blocked, zero mutations.
	before := gs.counts(t)
	rr := gs.call(http.MethodPatch, "/api/projects/"+gs.fx.projectID+"/items/"+gs.itemID+"/floor-status",
		gs.h.tokenA, `{"status":"cut"}`, "", "")
	continuityBlocked(t, rr.Code, rr.Body.String(), "mixed floor-status")
	gs.gateAssertZeroMutations(t, before, "mixed floor-status")

	// floor-scan: blocked, zero mutations.
	before = gs.counts(t)
	rr = gs.call(http.MethodPost, "/api/projects/"+gs.fx.projectID+"/floor-scan",
		gs.h.tokenA, `{"item_id":"`+gs.itemID+`","advance":true}`, "", "")
	continuityBlocked(t, rr.Code, rr.Body.String(), "mixed floor-scan")
	gs.gateAssertZeroMutations(t, before, "mixed floor-scan")

	// activity finish with physical effect: blocked in ONE transaction — the
	// activity row is NOT finished (finished_at NULL) and no floor event was
	// minted.
	gateClaimActivity(t, gs, "mix-741-act-0001")
	actorA := fiActorA()
	err := fiTx(t, gs.fx.store, actorA, func(ctx context.Context) error {
		_, fErr := gs.fx.store.FinishProductionActivityWithPhysicalEffect(ctx, storage.FinishActivityPhysicalCommand{
			ActivityID: "mix-741-act-0001", PiecesCount: 2, Notes: "must not finish", ActorID: rlsUserA,
		})
		return fErr
	})
	if err == nil || !strings.Contains(err.Error(), "liberación anterior") {
		t.Fatalf("mixed activity finish must block with the continuity copy, got=%v", err)
	}
	finishedAt, _, _ := gateActivityPoststate(t, gs, "mix-741-act-0001")
	if finishedAt != nil {
		t.Fatalf("mixed activity finish must leave finished_at NULL, got %v", finishedAt)
	}

	// Part advance on the mixed set is equally blocked BEFORE any closure
	// logic (the pre-guard owns the ambiguous verdict).
	before = gs.counts(t)
	rr = gs.advance(`{"operation_type":"cnc","operator_name":"Op"}`)
	continuityBlocked(t, rr.Code, rr.Body.String(), "mixed part advance")
	gs.gateAssertZeroMutations(t, before, "mixed part advance")

	// Regeneration over the mixed set never reconciles automatically.
	before = gs.counts(t)
	rr = gs.call(http.MethodPut, "/api/projects/"+gs.fx.projectID+"/part-executions",
		gs.h.tokenA, `{"force":true}`, "", "mix-force-741")
	continuityBlocked(t, rr.Code, rr.Body.String(), "mixed regeneration")
	gs.gateAssertZeroMutations(t, before, "mixed regeneration")
}

// Canonical executions WITHOUT a ProductionRevision pin: unverifiable
// provenance blocks the item-level writers (no correlation is invented, and
// the empty revision is NOT treated as "no executions").
func TestReleaseContinuity_UnpinnedExecutionsBlockItemWriters(t *testing.T) {
	gs := gateSetupFixture(t)
	gs.completeEngineering(t, gs.p1.Release.ID, "nopin741")
	gs.seedMaterialsAuthorization(t, gs.p1.Release.ID, gs.p1.Release.ManufacturingFingerprint, false)

	// Every part loses its release pin (authority stays P1): ambiguous.
	continuityRewritePartRevisions(t, gs, []string{""})

	before := gs.counts(t)
	rr := gs.call(http.MethodPatch, "/api/projects/"+gs.fx.projectID+"/items/"+gs.itemID+"/floor-status",
		gs.h.tokenA, `{"status":"cut"}`, "", "")
	continuityBlocked(t, rr.Code, rr.Body.String(), "unpinned floor-status")
	gs.gateAssertZeroMutations(t, before, "unpinned floor-status")

	rr = gs.call(http.MethodPost, "/api/projects/"+gs.fx.projectID+"/floor-scan",
		gs.h.tokenA, `{"item_id":"`+gs.itemID+`","advance":true}`, "", "")
	continuityBlocked(t, rr.Code, rr.Body.String(), "unpinned floor-scan")
	gs.gateAssertZeroMutations(t, before, "unpinned floor-scan")

	// Regeneration also refuses the unverifiable set.
	rr = gs.call(http.MethodPut, "/api/projects/"+gs.fx.projectID+"/part-executions",
		gs.h.tokenA, `{}`, "", "nopin-regen-741")
	continuityBlocked(t, rr.Code, rr.Body.String(), "unpinned regeneration")
}

// A present-but-undecodable execution payload is CORRUPT STATE, never "no
// executions": the physical writer fails closed with zero mutations (the
// error propagates; data is never repaired here).
func TestReleaseContinuity_MalformedExecutionPayloadFailsClosed(t *testing.T) {
	gs := gateSetupFixture(t)
	gs.completeEngineering(t, gs.p1.Release.ID, "badjson741")
	gs.seedMaterialsAuthorization(t, gs.p1.Release.ID, gs.p1.Release.ManufacturingFingerprint, false)
	before := gs.counts(t)

	if _, err := gs.fx.admin.Exec(gs.ctx, `
		UPDATE projects SET part_instances = '{"shape":"not-an-array"}'::jsonb
		WHERE id = $1`, gs.fx.projectID); err != nil {
		t.Fatal(err)
	}

	// floor-status: NOT 200, zero mutations (fail closed on corrupt state).
	rr := gs.call(http.MethodPatch, "/api/projects/"+gs.fx.projectID+"/items/"+gs.itemID+"/floor-status",
		gs.h.tokenA, `{"status":"cut"}`, "", "")
	if rr.Code == 200 {
		t.Fatalf("malformed payload must block the floor writer, got 200 %s", rr.Body.String())
	}
	var floorStatus string
	if err := gs.fx.admin.QueryRow(gs.ctx, `
		SELECT COALESCE(floor_status,'pending') FROM project_items WHERE id=$1`, gs.itemID).Scan(&floorStatus); err != nil {
		t.Fatal(err)
	}
	if floorStatus != "pending" {
		t.Fatalf("malformed payload: item must stay pending, got %q", floorStatus)
	}
	var events int
	if err := gs.fx.admin.QueryRow(gs.ctx, `
		SELECT COUNT(*) FROM project_item_floor_events WHERE project_id=$1`, gs.fx.projectID).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if events != before.floorEvents {
		t.Fatalf("malformed payload: 0 new floor events expected, before=%d after=%d", before.floorEvents, events)
	}

	// activity finish: same fail-closed frontier (nothing finishes).
	gateClaimActivity(t, gs, "badjson-741-act-0001")
	actorA := fiActorA()
	if err := fiTx(t, gs.fx.store, actorA, func(ctx context.Context) error {
		_, fErr := gs.fx.store.FinishProductionActivityWithPhysicalEffect(ctx, storage.FinishActivityPhysicalCommand{
			ActivityID: "badjson-741-act-0001", PiecesCount: 1, Notes: "must not finish", ActorID: rlsUserA,
		})
		return fErr
	}); err == nil {
		t.Fatal("malformed payload: activity finish must fail closed")
	}
	finishedAt, _, _ := gateActivityPoststate(t, gs, "badjson-741-act-0001")
	if finishedAt != nil {
		t.Fatalf("malformed payload: activity must stay unfinished, got %v", finishedAt)
	}
}
