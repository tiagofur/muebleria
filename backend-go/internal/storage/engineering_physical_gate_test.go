package storage_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #740 PR 2 — the operational physical work gate matrix over real
// PostgreSQL + real HTTP.
//
//	ProductionRelease exacto
//	  → Engineering completed (durable, exact release)
//	  → Materials authorized (planning requirements pin release+fingerprint,
//	    Release evidence present — regular or audited override)
//	  → Physical execution allowed (on top of every existing gate)
//
// Every negative asserts the full zero-mutation poststate: part/unit/floor
// status unchanged, 0 floor events, 0 lifecycle events faking progress.

// gateSetup is the shared scenario scaffolding: canonical P1 + planned
// executions + HTTP harness with manufacturing reassigned to the caller org
// (same reassignment TestOpsDt1 performs).
type gateSetup struct {
	fx      *releaseFixture
	p1      *storage.ProductionReleaseReadback
	h       *engineeringHttpHarness
	call    func(method, target, credential, body, ifMatch, idemKey string) *httptest.ResponseRecorder
	part    domain.PartInstance
	unit    domain.ModuleUnitExecution
	itemID  string
	ctx     context.Context
	advance func(body string) *httptest.ResponseRecorder
}

func gateSetupFixture(t *testing.T) *gateSetup {
	t.Helper()
	fx := setupReleaseFixture(t)
	p1 := opsDt1CreateReleaseP1(t, fx)
	multiOrgExec(t, fx.admin, `ALTER TABLE projects DISABLE TRIGGER protect_project_organization_ownership;
 UPDATE projects SET manufacturing_organization_id=organization_id WHERE id='`+fx.projectID+`';
 ALTER TABLE projects ENABLE TRIGGER protect_project_organization_ownership;`)
	h := engineeringTestHarness(t, fx)
	gs := &gateSetup{fx: fx, p1: p1, h: h, ctx: context.Background()}
	gs.call = h.call

	// Preparation only: canonical PLANNED executions (must work before
	// Engineering completion — #739 regression).
	rr := gs.call(http.MethodPut, "/api/projects/"+fx.projectID+"/part-executions", h.tokenA, "{}", "", "gate-gen-1")
	if rr.Code != 200 {
		t.Fatalf("planned generation=%d %s", rr.Code, rr.Body.String())
	}
	var generated struct {
		Parts []domain.PartInstance        `json:"part_instances"`
		Units []domain.ModuleUnitExecution `json:"module_units"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &generated); err != nil {
		t.Fatal(err)
	}
	if len(generated.Parts) == 0 || len(generated.Units) == 0 {
		t.Fatal("generation produced no parts/units")
	}
	gs.part = generated.Parts[0]
	gs.unit = generated.Units[0]
	if err := fx.admin.QueryRow(gs.ctx, `
		SELECT id FROM project_items WHERE project_id = $1 ORDER BY id LIMIT 1`, fx.projectID).
		Scan(&gs.itemID); err != nil {
		t.Fatal(err)
	}
	gs.advance = func(body string) *httptest.ResponseRecorder {
		return gs.call(http.MethodPost, "/api/projects/"+fx.projectID+"/parts/"+gs.part.ID+"/advance",
			h.tokenA, body, "", "")
	}
	return gs
}

// gateCounts is the zero-mutation poststate snapshot.
type gateCounts struct {
	floorEvents    int
	firstOpStatus  string
	unitStatus     string
	itemFloor      string
	progressEvents int
}

func (gs *gateSetup) counts(t *testing.T) gateCounts {
	t.Helper()
	var c gateCounts
	if err := gs.fx.admin.QueryRow(gs.ctx, `
		SELECT COUNT(*) FROM project_item_floor_events WHERE project_id = $1`, gs.fx.projectID).
		Scan(&c.floorEvents); err != nil {
		t.Fatal(err)
	}
	if err := gs.fx.admin.QueryRow(gs.ctx, `
		SELECT pi.elem->'required_operations'->0->>'status'
		FROM projects, jsonb_array_elements(part_instances) AS pi(elem)
		WHERE projects.id = $1 AND pi.elem->>'id' = $2`, gs.fx.projectID, gs.part.ID).
		Scan(&c.firstOpStatus); err != nil {
		t.Fatal(err)
	}
	if err := gs.fx.admin.QueryRow(gs.ctx, `
		SELECT mu.elem->>'status'
		FROM projects, jsonb_array_elements(module_units) AS mu(elem)
		WHERE projects.id = $1 AND mu.elem->>'id' = $2`, gs.fx.projectID, gs.unit.ID).
		Scan(&c.unitStatus); err != nil {
		t.Fatal(err)
	}
	if err := gs.fx.admin.QueryRow(gs.ctx, `
		SELECT COALESCE(floor_status, 'pending') FROM project_items WHERE id = $1`, gs.itemID).Scan(&c.itemFloor); err != nil {
		t.Fatal(err)
	}
	if err := gs.fx.admin.QueryRow(gs.ctx, `
		SELECT COUNT(*) FROM project_events WHERE project_id = $1
		  AND type IN ('rework_started','quality_issue_reported','materials_ready')`, gs.fx.projectID).
		Scan(&c.progressEvents); err != nil {
		t.Fatal(err)
	}
	return c
}

// gateAssertZeroMutations verifies the blocked writer left no physical or
// audit trace relative to the pre-call snapshot.
func (gs *gateSetup) gateAssertZeroMutations(t *testing.T, before gateCounts, where string) {
	t.Helper()
	after := gs.counts(t)
	if after != before {
		t.Fatalf("%s: expected zero mutations, before=%+v after=%+v", where, before, after)
	}
}

// completeEngineering drives the durable engineering evidence to completed
// through the supported HTTP commands (idempotent start + If-Match complete).
func (gs *gateSetup) completeEngineering(t *testing.T, releaseID, keyPrefix string) {
	t.Helper()
	gateCompleteEngineeringHTTP(t, gs.h.call, gs.h.tokenEng, gs.fx.projectID, releaseID, keyPrefix)
}

// gateCompleteEngineeringHTTP is the storage-level completion path for tests
// without the HTTP harness (shared with the OPS-DT-1 regressions).
func gateCompleteEngineeringHTTP(t *testing.T,
	call func(method, target, credential, body, ifMatch, idemKey string) *httptest.ResponseRecorder,
	token, projectID, releaseID, keyPrefix string) {
	t.Helper()
	if rr := call(http.MethodPost, "/api/projects/"+projectID+"/production-releases/"+releaseID+"/engineering:start",
		token, "", "", keyPrefix+"-start-key-0001"); rr.Code != 200 {
		t.Fatalf("engineering start=%d %s", rr.Code, rr.Body.String())
	}
	if rr := call(http.MethodPost, "/api/projects/"+projectID+"/production-releases/"+releaseID+"/engineering:complete",
		token, "", `"v1"`, keyPrefix+"-complete-key-0001"); rr.Code != 200 {
		t.Fatalf("engineering complete=%d %s", rr.Code, rr.Body.String())
	}
}

// gateSeedMaterialsAuthorization writes the OC-054 authorization evidence for
// the exact release at storage level (mirroring the HandleMaterialsRelease
// domain transition). Shared with the OPS-DT-1 regressions.
func gateSeedMaterialsAuthorization(t *testing.T, fx *releaseFixture, projectID, releaseID, fingerprint string, override bool) {
	t.Helper()
	actorA := fiActorA()
	now := time.Now().UTC()
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, mErr := fx.store.MutateProjectMaterialPlanningForRelease(ctx, projectID, releaseID, func(snap *domain.MaterialPlanningSnapshot) (*domain.MaterialPlanningMutation, error) {
			evidence := &domain.MaterialsReleaseEvidence{ReleasedAt: now, ReleasedBy: rlsUserA}
			if override {
				evidence.Override = &domain.MaterialsReleaseOverride{
					Reason:        "Producción autorizada con faltantes parciales registrados",
					ByUserID:      rlsUserA,
					At:            now,
					FailingChecks: []string{"lines_reserved"},
				}
			}
			planning := &domain.MaterialPlanning{
				ID:          domain.NewMaterialPlanningID("mplan"),
				ProjectID:   projectID,
				Requirements: &domain.MaterialRequirementsSnapshot{
					ReleaseID:      releaseID,
					BomFingerprint: fingerprint,
					DerivedAt:      now,
					DerivedBy:      rlsUserA,
					Lines:          []domain.MaterialRequirementLine{{Kind: "tableros", MaterialID: releaseMaterial, Quantity: 4}},
				},
				Reservations: []domain.MaterialReservation{},
				Release:      evidence,
				CreatedAt:    now,
			}
			if err := domain.ValidateMaterialPlanningShape(planning); err != nil {
				return nil, err
			}
			return &domain.MaterialPlanningMutation{Planning: planning}, nil
		})
		return mErr
	})
	if err != nil {
		t.Fatalf("seed materials authorization: %v", err)
	}
}

// seedMaterialsAuthorization delegates to the shared storage-level seeder.
func (gs *gateSetup) seedMaterialsAuthorization(t *testing.T, releaseID, fingerprint string, override bool) {
	t.Helper()
	gateSeedMaterialsAuthorization(t, gs.fx, gs.fx.projectID, releaseID, fingerprint, override)
}

// Sequential matrix (§10): pending → in_progress → completed-without-materials
// → completed+authorized. Only the last state allows the physical advance.
func TestPhysicalWorkGate_SequentialMatrix(t *testing.T) {
	gs := gateSetupFixture(t)

	// 1. Engineering pending + materials pending → blocked (engineering).
	before := gs.counts(t)
	rr := gs.advance(`{"operation_type":"cut","operator_name":"Op"}`)
	if rr.Code != http.StatusConflict || !strings.Contains(rr.Body.String(), "Ingeniería pendiente") {
		t.Fatalf("pending: expected 409 Ingeniería pendiente, got=%d %s", rr.Code, rr.Body.String())
	}
	gs.gateAssertZeroMutations(t, before, "pending")

	// 2. Engineering in_progress → still blocked (preparation is not completion).
	if err := gateStartEngineering(gs, "matrix"); err != nil {
		t.Fatal(err)
	}
	before = gs.counts(t)
	rr = gs.advance(`{"operation_type":"cut","operator_name":"Op"}`)
	if rr.Code != http.StatusConflict || !strings.Contains(rr.Body.String(), "Ingeniería pendiente") {
		t.Fatalf("in_progress: expected 409 Ingeniería pendiente, got=%d %s", rr.Code, rr.Body.String())
	}
	gs.gateAssertZeroMutations(t, before, "in_progress")

	// 3. Engineering completed + materials pending → blocked (materials).
	gs.completeEngineering(t, gs.p1.Release.ID, "matrix")
	before = gs.counts(t)
	rr = gs.advance(`{"operation_type":"cut","operator_name":"Op"}`)
	if rr.Code != http.StatusConflict || !strings.Contains(rr.Body.String(), "Material pendiente de autorización") {
		t.Fatalf("materials pending: expected 409 Material pendiente, got=%d %s", rr.Code, rr.Body.String())
	}
	gs.gateAssertZeroMutations(t, before, "materials pending")

	// 4. Materials authorized (regular release) → allowed, mutation + audit.
	gs.seedMaterialsAuthorization(t, gs.p1.Release.ID, gs.p1.Release.ManufacturingFingerprint, false)
	rr = gs.advance(`{"operation_type":"cut","operator_name":"Op"}`)
	if rr.Code != 200 {
		t.Fatalf("authorized: expected 200, got=%d %s", rr.Code, rr.Body.String())
	}
	after := gs.counts(t)
	if after.firstOpStatus != string(domain.PartOperationStatusCompleted) {
		t.Fatalf("authorized: first operation must be completed, got %s", after.firstOpStatus)
	}
	if after.floorEvents == 0 {
		t.Fatal("authorized: the real advance must record its floor event")
	}
}

// gateStartEngineering starts (does not complete) the engineering evidence.
func gateStartEngineering(gs *gateSetup, key string) error {
	rr := gs.call(http.MethodPost, "/api/projects/"+gs.fx.projectID+"/production-releases/"+gs.p1.Release.ID+"/engineering:start",
		gs.h.tokenEng, "", "", key+"-start-key-0001")
	if rr.Code != 200 {
		return fmt.Errorf("engineering start=%d %s", rr.Code, rr.Body.String())
	}
	return nil
}

// An authorized exception (override) authorizes physical work exactly like a
// regular release — its provenance stays auditable.
func TestPhysicalWorkGate_AuthorizedExceptionAllowsWork(t *testing.T) {
	gs := gateSetupFixture(t)
	gs.completeEngineering(t, gs.p1.Release.ID, "exception")
	gs.seedMaterialsAuthorization(t, gs.p1.Release.ID, gs.p1.Release.ManufacturingFingerprint, true)

	rr := gs.advance(`{"operation_type":"cut","operator_name":"Op"}`)
	if rr.Code != 200 {
		t.Fatalf("authorized exception: expected 200, got=%d %s", rr.Code, rr.Body.String())
	}
	// The exception provenance is auditable on the planning evidence.
	var overrideReason string
	if err := gs.fx.admin.QueryRow(gs.ctx, `
		SELECT material_planning->'release'->'override'->>'reason' FROM projects WHERE id=$1`,
		gs.fx.projectID).Scan(&overrideReason); err != nil {
		t.Fatal(err)
	}
	if overrideReason == "" {
		t.Fatal("authorized exception must keep its reason auditable")
	}
}

// Uncorrelated material evidence does not authorize: a stamp whose
// requirements pin a different release/fingerprint is not authorization for
// the governing release.
func TestPhysicalWorkGate_UncorrelatedMaterialsDoNotAuthorize(t *testing.T) {
	gs := gateSetupFixture(t)
	gs.completeEngineering(t, gs.p1.Release.ID, "uncorrelated")
	// Authorization evidence pinned to a FOREIGN release id + fingerprint
	// (written through the non-exact planning mutation: the exact-release
	// command rightly refuses foreign ids — this simulates a legacy stamp).
	actorA := fiActorA()
	now := time.Now().UTC()
	if err := fiTx(t, gs.fx.store, actorA, func(ctx context.Context) error {
		_, mErr := gs.fx.store.MutateProjectMaterialPlanning(ctx, gs.fx.projectID, func(snap *domain.MaterialPlanningSnapshot) (*domain.MaterialPlanningMutation, error) {
			planning := &domain.MaterialPlanning{
				ID:        domain.NewMaterialPlanningID("mplan"),
				ProjectID: gs.fx.projectID,
				Requirements: &domain.MaterialRequirementsSnapshot{
					ReleaseID:      "11111111-2222-3333-4444-555555555555",
					BomFingerprint: "fingerprint-of-another-release",
					DerivedAt:      now,
					DerivedBy:      rlsUserA,
					Lines:          []domain.MaterialRequirementLine{{Kind: "tableros", MaterialID: releaseMaterial, Quantity: 4}},
				},
				Reservations: []domain.MaterialReservation{},
				Release:      &domain.MaterialsReleaseEvidence{ReleasedAt: now, ReleasedBy: rlsUserA},
				CreatedAt:    now,
			}
			return &domain.MaterialPlanningMutation{Planning: planning}, nil
		})
		return mErr
	}); err != nil {
		t.Fatalf("seed uncorrelated stamp: %v", err)
	}

	before := gs.counts(t)
	rr := gs.advance(`{"operation_type":"cut","operator_name":"Op"}`)
	if rr.Code != http.StatusConflict || !strings.Contains(rr.Body.String(), "Material pendiente de autorización") {
		t.Fatalf("uncorrelated: expected 409 Material pendiente, got=%d %s", rr.Code, rr.Body.String())
	}
	gs.gateAssertZeroMutations(t, before, "uncorrelated materials")
}

// All the physical writers fail closed before authorization; the quality
// OBSERVATION flow keeps working (registering an issue is not physical work).
func TestPhysicalWorkGate_AllWritersBlockedObservationKept(t *testing.T) {
	gs := gateSetupFixture(t)
	// Engineering completed, materials pending: isolates the material blocker
	// for every writer.
	gs.completeEngineering(t, gs.p1.Release.ID, "writers")

	projects := "/api/projects/" + gs.fx.projectID
	materialsPending := func(t *testing.T, rr *httptest.ResponseRecorder, what string) {
		t.Helper()
		if rr.Code != http.StatusConflict || !strings.Contains(rr.Body.String(), "Material pendiente de autorización") {
			t.Fatalf("%s: expected 409 Material pendiente, got=%d %s", what, rr.Code, rr.Body.String())
		}
	}

	// Unit advance (assembly entry) — blocked.
	before := gs.counts(t)
	materialsPending(t, gs.call(http.MethodPost, projects+"/units/"+gs.unit.ID+"/advance", gs.h.tokenA,
		`{"target_status":"assembly"}`, "", ""), "unit advance")
	// Assembly override — blocked (an override is not a backdoor).
	materialsPending(t, gs.call(http.MethodPost, projects+"/units/"+gs.unit.ID+"/assembly-override", gs.h.tokenA,
		`{"reason":"apuro"}`, "", ""), "assembly override")
	// Part rework — blocked.
	materialsPending(t, gs.call(http.MethodPost, projects+"/parts/"+gs.part.ID+"/rework", gs.h.tokenA,
		`{"action":"rework","reason":"golpe"}`, "", ""), "part rework")
	// Unit QC — blocked.
	materialsPending(t, gs.call(http.MethodPost, projects+"/quality/qc/"+gs.unit.ID, gs.h.tokenA,
		`{"checklist":[{"code":"dimensions","passed":true}]}`, "", ""), "unit qc")
	// QC override — blocked.
	materialsPending(t, gs.call(http.MethodPost, projects+"/quality/qc/"+gs.unit.ID+"/override", gs.h.tokenA,
		`{"reason":"supervisor"}`, "", ""), "qc override")
	// Legacy item floor writers — blocked.
	materialsPending(t, gs.call(http.MethodPatch, projects+"/items/"+gs.itemID+"/floor-status", gs.h.tokenA,
		`{"status":"cut"}`, "", ""), "floor-status")
	materialsPending(t, gs.call(http.MethodPost, projects+"/floor-scan", gs.h.tokenA,
		`{"item_id":"`+gs.itemID+`","advance":true}`, "", ""), "floor-scan")
	gs.gateAssertZeroMutations(t, before, "writers matrix")

	// Observation flows keep working BEFORE authorization (#740
	// classification): reporting a quality issue is not physical work.
	rr := gs.call(http.MethodPost, projects+"/quality/issue", gs.h.tokenA,
		`{"description":"Alineación desviada en prototipo","category":"dimensional"}`, "", "")
	if rr.Code != 200 {
		t.Fatalf("quality issue observation: expected 200, got=%d %s", rr.Code, rr.Body.String())
	}
	var issue struct {
		Quality struct {
			Issues []domain.QualityIssue `json:"issues"`
		} `json:"quality"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &issue); err != nil || len(issue.Quality.Issues) == 0 {
		t.Fatalf("quality issue observation: cannot read issue (%v) %s", err, rr.Body.String())
	}
	// And the rework RESOLUTION of that issue is still physical → blocked.
	materialsPending(t, gs.call(http.MethodPost, projects+"/quality/rework", gs.h.tokenA,
		fmt.Sprintf(`{"issue_id":%q,"action":"rework","reason":"corregir","part_instance_id":%q}`,
			issue.Quality.Issues[0].ID, gs.part.ID), "", ""), "quality rework")

	// Activity finish with a floor side-effect — blocked before mutating the
	// activity row itself (fail-before-mutate).
	claim := gs.call(http.MethodPost, "/api/production/activity/claim", gs.h.tokenA,
		fmt.Sprintf(`{"project_id":%q,"item_id":%q,"sector":"cutting"}`, gs.fx.projectID, gs.itemID), "", "")
	if claim.Code != 200 {
		t.Fatalf("activity claim=%d %s", claim.Code, claim.Body.String())
	}
	var claimed struct {
		Activity domain.ProductionActivity `json:"activity"`
	}
	if err := json.Unmarshal(claim.Body.Bytes(), &claimed); err != nil {
		t.Fatal(err)
	}
	before = gs.counts(t)
	materialsPending(t, gs.call(http.MethodPost, "/api/production/activity/finish/"+claimed.Activity.ID,
		gs.h.tokenA, `{"pieces_count":2}`, "", ""), "activity finish")
	gs.gateAssertZeroMutations(t, before, "activity finish")
	var finishedAt *string
	if err := gs.fx.admin.QueryRow(gs.ctx,
		`SELECT finished_at::text FROM production_activities WHERE id::text=$1`, claimed.Activity.ID).Scan(&finishedAt); err != nil {
		t.Fatal(err)
	}
	if finishedAt != nil {
		t.Fatal("activity finish: the activity row must stay unmutated when the gate blocks its side-effect")
	}
}

// P1/P2: a newer release becomes the authority; P1 evidence never authorizes
// P2 work, and even fully re-prepared P2 evidence does not authorize advancing
// P1 executions (release mismatch).
func TestPhysicalWorkGate_P2DoesNotReuseP1Evidence(t *testing.T) {
	gs := gateSetupFixture(t)
	// P1 fully prepared and authorized, and its work already advancing.
	gs.completeEngineering(t, gs.p1.Release.ID, "p1")
	gs.seedMaterialsAuthorization(t, gs.p1.Release.ID, gs.p1.Release.ManufacturingFingerprint, false)
	if rr := gs.advance(`{"operation_type":"cut","operator_name":"Op"}`); rr.Code != 200 {
		t.Fatalf("P1 authorized advance=%d %s", rr.Code, rr.Body.String())
	}

	// Authority change: publish R4, approve it, release P2.
	actorA := fiActorA()
	var p2ID string
	err := releaseTx(t, gs.fx.store, actorA, func(ctx context.Context) error {
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
			QuoteRevisionID:  gs.fx.quoteQ3,
			ActorUserID:      rlsUserA,
			RequestID:        "req-gate-p2",
		})
		if err != nil {
			return err
		}
		p2ID = p2.Release.ID
		return nil
	})
	if err != nil {
		t.Fatalf("create P2: %v", err)
	}

	// P2 is the authority and is pending: P1's completed engineering +
	// authorized materials do NOT carry over — the next P1 advance blocks.
	before := gs.counts(t)
	rr := gs.advance(`{"operation_type":"cnc","operator_name":"Op"}`)
	if rr.Code != http.StatusConflict || !strings.Contains(rr.Body.String(), "Ingeniería pendiente") {
		t.Fatalf("P2 pending: expected 409 Ingeniería pendiente, got=%d %s", rr.Code, rr.Body.String())
	}
	gs.gateAssertZeroMutations(t, before, "P2 pending")

	// P2 fully re-prepared: P1 work STILL cannot advance — it belongs to a
	// previous release (release mismatch, not silent reuse).
	var p2Fingerprint string
	if err := gs.fx.admin.QueryRow(gs.ctx,
		`SELECT manufacturing_fingerprint FROM production_releases WHERE id=$1`, p2ID).Scan(&p2Fingerprint); err != nil {
		t.Fatal(err)
	}
	gs.completeEngineering(t, p2ID, "p2")
	gs.seedMaterialsAuthorization(t, p2ID, p2Fingerprint, false)
	before = gs.counts(t)
	rr = gs.advance(`{"operation_type":"cnc","operator_name":"Op"}`)
	if rr.Code != http.StatusConflict || !strings.Contains(rr.Body.String(), "liberación anterior") {
		t.Fatalf("P1 work under P2 authority: expected 409 release mismatch, got=%d %s", rr.Code, rr.Body.String())
	}
	gs.gateAssertZeroMutations(t, before, "P1 work under P2 authority")
}

// Security: the gate never widens permissions — a vendedor keeps getting 403,
// a cross-org caller (manufacturing org, owner-private evidence) fails closed
// with zero mutations.
func TestPhysicalWorkGate_RolesAndCrossOrg(t *testing.T) {
	gs := gateSetupFixture(t)
	gs.completeEngineering(t, gs.p1.Release.ID, "roles")
	gs.seedMaterialsAuthorization(t, gs.p1.Release.ID, gs.p1.Release.ManufacturingFingerprint, false)

	// Vendedor: 403 by the existing permission gate, nothing mutated.
	before := gs.counts(t)
	rr := gs.call(http.MethodPost, "/api/projects/"+gs.fx.projectID+"/parts/"+gs.part.ID+"/advance",
		gs.h.tokenSeller, `{"operation_type":"cut"}`, "", "")
	if rr.Code != http.StatusForbidden {
		t.Fatalf("vendedor: expected 403, got=%d %s", rr.Code, rr.Body.String())
	}
	gs.gateAssertZeroMutations(t, before, "vendedor")

	// Cross-org (org B admin on org A's project): fails closed, zero
	// mutations — the owner-private evidence is not readable cross-org.
	before = gs.counts(t)
	rr = gs.call(http.MethodPost, "/api/projects/"+gs.fx.projectID+"/parts/"+gs.part.ID+"/advance",
		gs.h.tokenB, `{"operation_type":"cut"}`, "", "")
	if rr.Code != http.StatusConflict && rr.Code != http.StatusForbidden && rr.Code != http.StatusNotFound {
		t.Fatalf("cross-org: expected fail-closed 403/404/409, got=%d %s", rr.Code, rr.Body.String())
	}
	gs.gateAssertZeroMutations(t, before, "cross-org")
}

// Concurrency §18: two simultaneous advances of the same piece — exactly one
// physical mutation wins, the loser fails with the honest conflict.
func TestPhysicalWorkGate_ConcurrentSamePartSingleMutation(t *testing.T) {
	gs := gateSetupFixture(t)
	gs.completeEngineering(t, gs.p1.Release.ID, "concurrent")
	gs.seedMaterialsAuthorization(t, gs.p1.Release.ID, gs.p1.Release.ManufacturingFingerprint, false)

	var wg sync.WaitGroup
	results := make([]*httptest.ResponseRecorder, 2)
	for i := range results {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results[i] = gs.call(http.MethodPost, "/api/projects/"+gs.fx.projectID+"/parts/"+gs.part.ID+"/advance",
				gs.h.tokenA, `{"operation_type":"cut","operator_name":"Op"}`, "", "")
		}(i)
	}
	wg.Wait()
	ok, conflict := 0, 0
	for _, rr := range results {
		switch rr.Code {
		case 200:
			ok++
		case 409:
			conflict++
		default:
			t.Fatalf("unexpected concurrent result=%d %s", rr.Code, rr.Body.String())
		}
	}
	if ok != 1 || conflict != 1 {
		t.Fatalf("concurrent advance: expected exactly one winner, got ok=%d conflict=%d", ok, conflict)
	}
	after := gs.counts(t)
	if after.firstOpStatus != string(domain.PartOperationStatusCompleted) {
		t.Fatalf("concurrent: operation must be completed exactly once, got %s", after.firstOpStatus)
	}
	if after.floorEvents != 1 {
		t.Fatalf("concurrent: exactly one floor event expected, got %d", after.floorEvents)
	}
}

// TOCTOU §9/§18: the gate decision is read UNDER the project row lock. While
// a gated write waits for the lock, an authority change commits; when the
// write acquires the lock it re-reads the post-change evidence and fails
// closed (withdrawal) — or proceeds honestly when the completing command
// committed first (completion).
func TestPhysicalWorkGate_AuthorityChangeUnderLockFailsClosed(t *testing.T) {
	gs := gateSetupFixture(t)
	gs.completeEngineering(t, gs.p1.Release.ID, "toctou")
	gs.seedMaterialsAuthorization(t, gs.p1.Release.ID, gs.p1.Release.ManufacturingFingerprint, false)

	actorA := fiActorA()
	locked := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)
	now := time.Now().UTC()

	// Holder: a material mutation takes the projects row FOR UPDATE (its
	// standard lock) and re-pins the authorization evidence to a foreign
	// release; the lock is held until this transaction commits — simulating
	// the authorization changing while a gated command is in flight.
	go func() {
		err := fiTx(t, gs.fx.store, actorA, func(ctx context.Context) error {
			_, mErr := gs.fx.store.MutateProjectMaterialPlanning(ctx, gs.fx.projectID, func(snap *domain.MaterialPlanningSnapshot) (*domain.MaterialPlanningMutation, error) {
				planning := &domain.MaterialPlanning{
					ID:        domain.NewMaterialPlanningID("mplan"),
					ProjectID: gs.fx.projectID,
					Requirements: &domain.MaterialRequirementsSnapshot{
						ReleaseID:      "99999999-9999-9999-9999-999999999999",
						BomFingerprint: "fingerprint-of-another-release",
						DerivedAt:      now,
						DerivedBy:      rlsUserA,
						Lines:          []domain.MaterialRequirementLine{{Kind: "tableros", MaterialID: releaseMaterial, Quantity: 4}},
					},
					Reservations: []domain.MaterialReservation{},
					Release:      &domain.MaterialsReleaseEvidence{ReleasedAt: now, ReleasedBy: rlsUserA},
					CreatedAt:    now,
				}
				return &domain.MaterialPlanningMutation{Planning: planning}, nil
			})
			if mErr != nil {
				return mErr
			}
			close(locked)
			<-release
			return nil
		})
		done <- err
	}()

	<-locked
	writeDone := make(chan error, 1)
	go func() {
		writeDone <- fiTx(t, gs.fx.store, actorA, func(ctx context.Context) error {
			return gs.fx.store.SetProjectItemFloorStatusGated(ctx, storage.ItemFloorAdvance{
				ProjectID: gs.fx.projectID,
				ItemID:    gs.itemID,
				Status:    "cut",
			})
		})
	}()
	// Let the gated write queue behind the holder's lock, then commit the
	// authority change.
	time.Sleep(150 * time.Millisecond)
	close(release)
	if err := <-done; err != nil {
		t.Fatalf("holder tx: %v", err)
	}

	// The gated write re-read the POST-commit evidence under its own lock:
	// the authorization no longer correlates with the governing release.
	if err := <-writeDone; err == nil {
		t.Fatal("TOCTOU: gated write must fail closed when the authorization changed under the lock")
	} else if !strings.Contains(err.Error(), "Material pendiente") {
		t.Fatalf("TOCTOU: expected material blocker, got=%v", err)
	}
	var floorStatus string
	if err := gs.fx.admin.QueryRow(gs.ctx,
		`SELECT COALESCE(floor_status, 'pending') FROM project_items WHERE id=$1`, gs.itemID).Scan(&floorStatus); err != nil {
		t.Fatal(err)
	}
	if floorStatus != "pending" {
		t.Fatalf("TOCTOU: item must stay pending, got %q", floorStatus)
	}
	var floorEvents int
	if err := gs.fx.admin.QueryRow(gs.ctx,
		`SELECT COUNT(*) FROM project_item_floor_events WHERE project_id=$1`, gs.fx.projectID).Scan(&floorEvents); err != nil {
		t.Fatal(err)
	}
	if floorEvents != 0 {
		t.Fatalf("TOCTOU: 0 floor events expected, got %d", floorEvents)
	}
}

// TOCTOU positive variant: the engineering completion command commits while
// the gated write waits for the lock — the write then sees the completed
// evidence under its own lock and proceeds.
func TestPhysicalWorkGate_CompletionUnderLockUnblocks(t *testing.T) {
	gs := gateSetupFixture(t)
	gs.seedMaterialsAuthorization(t, gs.p1.Release.ID, gs.p1.Release.ManufacturingFingerprint, false)
	// Engineering NOT completed yet.

	actorA := fiActorA()
	locked := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		err := fiTx(t, gs.fx.store, actorA, func(ctx context.Context) error {
			// StartReleaseEngineering takes the projects row FOR UPDATE — the
			// lock is held until this transaction commits, so the gated write
			// queues behind the completion.
			if _, err := gs.fx.store.StartReleaseEngineering(ctx, storage.StartReleaseEngineeringCommand{
				ProjectID: gs.fx.projectID, ReleaseID: gs.p1.Release.ID, ActorUserID: rlsUserA,
			}); err != nil {
				return err
			}
			close(locked)
			<-release
			_, err := gs.fx.store.CompleteReleaseEngineering(ctx, storage.CompleteReleaseEngineeringCommand{
				ProjectID: gs.fx.projectID, ReleaseID: gs.p1.Release.ID, ActorUserID: rlsUserA, ExpectedVersion: 1,
			})
			return err
		})
		done <- err
	}()

	<-locked
	writeDone := make(chan error, 1)
	go func() {
		writeDone <- fiTx(t, gs.fx.store, actorA, func(ctx context.Context) error {
			return gs.fx.store.SetProjectItemFloorStatusGated(ctx, storage.ItemFloorAdvance{
				ProjectID: gs.fx.projectID,
				ItemID:    gs.itemID,
				Status:    "cut",
			})
		})
	}()
	time.Sleep(150 * time.Millisecond)
	close(release)
	if err := <-done; err != nil {
		t.Fatalf("holder tx: %v", err)
	}

	if err := <-writeDone; err != nil {
		t.Fatalf("completion under lock: gated write must proceed with the committed evidence, got=%v", err)
	}
	var floorStatus string
	if err := gs.fx.admin.QueryRow(gs.ctx,
		`SELECT floor_status FROM project_items WHERE id=$1`, gs.itemID).Scan(&floorStatus); err != nil {
		t.Fatal(err)
	}
	if floorStatus != "cut" {
		t.Fatalf("completion under lock: item must advance to cut, got %q", floorStatus)
	}
}

// gateClaimActivity inserts one ACTIVE item-scoped cutting activity claimed
// by the admin operator (direct fixture row — claims are telemetry).
func gateClaimActivity(t *testing.T, gs *gateSetup, id string) {
	t.Helper()
	if _, err := gs.fx.admin.Exec(gs.ctx, `
		INSERT INTO production_activities
			(id, project_id, project_name, item_id, sector, type, operator_id, operator_name, started_at, organization_id)
		VALUES ($1, $2, 'Obra Gate Físico E2E', $3, 'cutting', 'claim', $4, 'Gate Operator', NOW(), $5)
	`, id, gs.fx.projectID, gs.itemID, rlsUserA, rlsOrgA); err != nil {
		t.Fatal(err)
	}
}

// gateActivityPoststate reads the durable activity row.
func gateActivityPoststate(t *testing.T, gs *gateSetup, id string) (finishedAt *string, piecesCount *int, notes *string) {
	t.Helper()
	if err := gs.fx.admin.QueryRow(gs.ctx, `
		SELECT finished_at::text, pieces_count, NULLIF(notes, '')
		FROM production_activities WHERE id = $1`, id).
		Scan(&finishedAt, &piecesCount, &notes); err != nil {
		t.Fatal(err)
	}
	return
}

// Review fix — the activity finish and its physical effect are ONE
// transaction under the project row lock. Positive: with valid authority the
// finish persists finished_at/pieces/notes AND advances the item with its
// F092 event in the same commit.
func TestPhysicalWorkGate_ActivityFinishAtomicHappyPath(t *testing.T) {
	gs := gateSetupFixture(t)
	gs.completeEngineering(t, gs.p1.Release.ID, "act-ok")
	gs.seedMaterialsAuthorization(t, gs.p1.Release.ID, gs.p1.Release.ManufacturingFingerprint, false)
	gateClaimActivity(t, gs, "act-atomic-ok-0001")

	actorA := fiActorA()
	var result *storage.FinishActivityResult
	err := fiTx(t, gs.fx.store, actorA, func(ctx context.Context) error {
		r, fErr := gs.fx.store.FinishProductionActivityWithPhysicalEffect(ctx, storage.FinishActivityPhysicalCommand{
			ActivityID: "act-atomic-ok-0001", PiecesCount: 4, Notes: "corte terminado",
			ActorID: rlsUserA,
		})
		result = r
		return fErr
	})
	if err != nil {
		t.Fatalf("atomic finish: %v", err)
	}
	if !result.FloorAdvanced || result.FromStatus != "pending" || result.ToStatus != "cut" {
		t.Fatalf("atomic finish must advance pending→cut in the same commit: %+v", result)
	}

	finishedAt, pieces, notes := gateActivityPoststate(t, gs, "act-atomic-ok-0001")
	if finishedAt == nil || pieces == nil || *pieces != 4 || notes == nil || *notes != "corte terminado" {
		t.Fatalf("atomic finish must persist the activity facts: finished=%v pieces=%v notes=%v", finishedAt, pieces, notes)
	}
	var floorStatus string
	if err := gs.fx.admin.QueryRow(gs.ctx,
		`SELECT COALESCE(floor_status,'pending') FROM project_items WHERE id=$1`, gs.itemID).Scan(&floorStatus); err != nil {
		t.Fatal(err)
	}
	if floorStatus != "cut" {
		t.Fatalf("item must be cut, got %q", floorStatus)
	}
	var events int
	if err := gs.fx.admin.QueryRow(gs.ctx, `
		SELECT COUNT(*) FROM project_item_floor_events
		WHERE project_id=$1 AND item_id=$2 AND source='activity'`, gs.fx.projectID, gs.itemID).
		Scan(&events); err != nil {
		t.Fatal(err)
	}
	if events != 1 {
		t.Fatalf("exactly one F092 activity event expected, got %d", events)
	}
}

// Review fix — RED/TOCTOU: P1 authorized → claim with physical effect → the
// authorization is withdrawn under the SAME project lock while the finish
// waits → the finish acquires the lock, re-evaluates the POST-commit
// evidence and blocks. Poststate: the activity is NOT finished (rollback of
// everything), the item did not move and no F092 row exists.
func TestPhysicalWorkGate_ActivityFinishAtomicTOCTOUWithdrawal(t *testing.T) {
	gs := gateSetupFixture(t)
	gs.completeEngineering(t, gs.p1.Release.ID, "act-toctou")
	gs.seedMaterialsAuthorization(t, gs.p1.Release.ID, gs.p1.Release.ManufacturingFingerprint, false)
	gateClaimActivity(t, gs, "act-atomic-toctou-0001")

	actorA := fiActorA()
	now := time.Now().UTC()
	locked := make(chan struct{})
	release := make(chan struct{})
	holderDone := make(chan error, 1)

	// Holder: re-pins the material authorization to a foreign release under
	// the project row lock and holds it until released.
	go func() {
		err := fiTx(t, gs.fx.store, actorA, func(ctx context.Context) error {
			_, mErr := gs.fx.store.MutateProjectMaterialPlanning(ctx, gs.fx.projectID, func(snap *domain.MaterialPlanningSnapshot) (*domain.MaterialPlanningMutation, error) {
				planning := &domain.MaterialPlanning{
					ID:          domain.NewMaterialPlanningID("mplan"),
					ProjectID:   gs.fx.projectID,
					Requirements: &domain.MaterialRequirementsSnapshot{
						ReleaseID:      "99999999-9999-9999-9999-999999999999",
						BomFingerprint: "fingerprint-of-another-release",
						DerivedAt:      now,
						DerivedBy:      rlsUserA,
						Lines:          []domain.MaterialRequirementLine{{Kind: "tableros", MaterialID: releaseMaterial, Quantity: 4}},
					},
					Reservations: []domain.MaterialReservation{},
					Release:      &domain.MaterialsReleaseEvidence{ReleasedAt: now, ReleasedBy: rlsUserA},
					CreatedAt:    now,
				}
				return &domain.MaterialPlanningMutation{Planning: planning}, nil
			})
			if mErr != nil {
				return mErr
			}
			close(locked)
			<-release
			return nil
		})
		holderDone <- err
	}()
	<-locked

	finishDone := make(chan error, 1)
	go func() {
		finishDone <- fiTx(t, gs.fx.store, actorA, func(ctx context.Context) error {
			_, fErr := gs.fx.store.FinishProductionActivityWithPhysicalEffect(ctx, storage.FinishActivityPhysicalCommand{
				ActivityID: "act-atomic-toctou-0001", PiecesCount: 2, Notes: "debería rodar todo back",
				ActorID:    rlsUserA,
			})
			return fErr
		})
	}()
	// Let the finish queue behind the holder's project lock, then commit the
	// authorization withdrawal.
	time.Sleep(150 * time.Millisecond)
	close(release)
	if err := <-holderDone; err != nil {
		t.Fatalf("holder tx: %v", err)
	}

	err := <-finishDone
	if err == nil {
		t.Fatal("TOCTOU: the atomic finish must fail closed when the authorization changed under the lock")
	}
	if !strings.Contains(err.Error(), "Material pendiente") {
		t.Fatalf("TOCTOU: expected the material blocker, got=%v", err)
	}

	// Poststate: NOTHING persisted — the whole transaction rolled back.
	finishedAt, pieces, notes := gateActivityPoststate(t, gs, "act-atomic-toctou-0001")
	if finishedAt != nil {
		t.Fatal("TOCTOU: finished_at must stay NULL when the gate blocks under the lock")
	}
	if pieces != nil && *pieces != 0 {
		t.Fatalf("TOCTOU: pieces_count must stay untouched, got %d", *pieces)
	}
	if notes != nil && *notes != "" {
		t.Fatalf("TOCTOU: notes must stay untouched, got %q", *notes)
	}
	var floorStatus string
	if err := gs.fx.admin.QueryRow(gs.ctx,
		`SELECT COALESCE(floor_status,'pending') FROM project_items WHERE id=$1`, gs.itemID).Scan(&floorStatus); err != nil {
		t.Fatal(err)
	}
	if floorStatus != "pending" {
		t.Fatalf("TOCTOU: item must stay pending, got %q", floorStatus)
	}
	var events int
	if err := gs.fx.admin.QueryRow(gs.ctx, `
		SELECT COUNT(*) FROM project_item_floor_events WHERE project_id=$1`, gs.fx.projectID).
		Scan(&events); err != nil {
		t.Fatal(err)
	}
	if events != 0 {
		t.Fatalf("TOCTOU: 0 F092 events expected, got %d", events)
	}
}
