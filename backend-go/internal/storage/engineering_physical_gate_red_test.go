package storage_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/api"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #740 PR 1 — DOCUMENTED OPERATIONAL RED over real PostgreSQL + real HTTP.
//
// Scenario (issue #740 acceptance, first checkbox):
//
//	valid Q/R/P context (P1 canonical, schema-v2 frozen routing)
//	→ NO durable Engineering completion for P1
//	→ NO material authorization for P1
//	→ attempt PHYSICAL advances through the currently reachable writers
//
// Today the advances SUCCEED. guardCanonicalExecutionRouting
// (production_release_authority.go) validates the frozen P/R/fingerprint
// pair and the frozen routing program — it never asks whether Engineering
// finished preparing THIS release or whether materials were authorized for
// it. The legacy item-level writers (floor-status PATCH, floor-scan POST)
// do not even resolve a release authority. That is the gap #740 exists for.
//
// These tests deliberately assert the CURRENT permissive behavior so the
// scenario stays executable evidence for the second delivery of #740 (the
// transversal physical gate). When PR 2 wires that gate, the expectations
// here flip to 409/403 with zero physical mutations — do not delete these
// proofs to make the gate green.
//
// Generation of PLANNED executions (PUT part-executions) is preparation,
// not physical work: it must keep working before Engineering completion
// (#739 regression), and it does.

// engineeringGateRedHarness builds the HTTP handler + admin token over the
// real store, mirroring the TestOpsDt1 pattern.
func engineeringGateRedHarness(t *testing.T, fx *releaseFixture, secret string) (func(method, target, credential, body string) *httptest.ResponseRecorder, string) {
	t.Helper()
	ctx := context.Background()
	var membership string
	var memberVersion, orgVersion int64
	if err := fx.admin.QueryRow(ctx, `SELECT m.id,m.credential_version,o.credential_version
 FROM memberships m JOIN organizations o ON o.id=m.organization_id
 WHERE m.organization_id=$1 AND m.user_id=$2`, rlsOrgA, rlsUserA).Scan(&membership, &memberVersion, &orgVersion); err != nil {
		t.Fatal(err)
	}
	token, err := auth.GenerateLegacyWebToken(rlsUserA, "rls-a@example.test", auth.TokenContext{
		Roles: []string{string(domain.RoleAdmin)}, OrgID: rlsOrgA, MembershipID: membership,
		MembershipCredentialVersion: memberVersion, OrganizationCredentialVersion: orgVersion,
	}, secret)
	if err != nil {
		t.Fatal(err)
	}
	handler := api.RegisterRoutes(api.NewServer(fx.store, secret, nil, 100, 100))
	call := func(method, target, credential, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, target, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+credential)
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		return rr
	}
	return call, token
}

// canonical physical route: one station completes one piece operation.
func TestEngineeringGateRed_PartAdvanceWithoutEngineeringCompletion(t *testing.T) {
	fx := setupReleaseFixture(t)
	p1 := opsDt1CreateReleaseP1(t, fx)
	// The shared fixture project is owned by Org A with manufacturing in Org B;
	// the physical endpoints require the caller's org to see manufacturing.
	// Same reassignment TestOpsDt1 performs before its HTTP calls.
	multiOrgExec(t, fx.admin, `ALTER TABLE projects DISABLE TRIGGER protect_project_organization_ownership;
 UPDATE projects SET manufacturing_organization_id=organization_id WHERE id='`+fx.projectID+`';
 ALTER TABLE projects ENABLE TRIGGER protect_project_organization_ownership;`)
	ctx := context.Background()
	call, token := engineeringGateRedHarness(t, fx, "engineering-gate-red-http-secret-0123456789")

	// Prestate: no material evidence correlated with P1 (this fixture never
	// derives materials) and no durable engineering completion for P1.
	var materialEvidence int
	if err := fx.admin.QueryRow(ctx, `
		SELECT COUNT(*) FROM projects
		WHERE id = $1 AND material_planning IS NULL AND materials_release IS NULL`, fx.projectID).
		Scan(&materialEvidence); err != nil {
		t.Fatal(err)
	}
	if materialEvidence != 1 {
		t.Fatal("prestate: expected no material planning/release for the fixture project")
	}
	var engineeringRows int
	if err := fx.admin.QueryRow(ctx, `
		SELECT COUNT(*) FROM production_release_engineering WHERE release_id = $1`, p1.Release.ID).
		Scan(&engineeringRows); err != nil {
		// Before migration 000134 the relation does not exist — the same
		// "no durable engineering evidence" prestate this RED documents.
		if !strings.Contains(err.Error(), "does not exist") {
			t.Fatal(err)
		}
		engineeringRows = 0
	}
	if engineeringRows != 0 {
		t.Fatalf("prestate: expected no durable engineering evidence for %s", p1.Release.ID)
	}
	t.Logf("RED prestate: release=%s (P%d, fp=%s) durable_engineering=none material_evidence=none actor=%s role=admin",
		p1.Release.ID, p1.Release.ReleaseNumber, p1.Release.ManufacturingFingerprint, rlsUserA)

	// Preparation: canonical generation of PLANNED executions (server-derived,
	// empty body). Must succeed before Engineering completion (#739).
	rr := call(http.MethodPut, "/api/projects/"+fx.projectID+"/part-executions", token, `{}`)
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
	if len(generated.Parts) == 0 {
		t.Fatal("generation produced no parts")
	}
	part := generated.Parts[0]
	if part.Status != domain.PartInstanceStatusPending || len(part.RequiredOperations) == 0 {
		t.Fatalf("first part must be pending with queued operations: %+v", part)
	}

	// PHYSICAL ACTION UNDER TEST: complete the first cut of the first piece.
	// Current behavior: 200 — physical work starts with zero engineering
	// completion and zero material authorization for the exact release.
	advancePath := "/api/projects/" + fx.projectID + "/parts/" + part.ID + "/advance"
	rr = call(http.MethodPost, advancePath, token, `{"operation_type":"cut","operator_name":"RED Operator"}`)
	t.Logf("RED advance: POST %s -> %d %s", advancePath, rr.Code, rr.Body.String())
	if rr.Code != 200 {
		t.Fatalf("documented RED: part advance is currently expected to succeed (HTTP 200); "+
			"if it now fails, the physical gate landed — flip this assertion to the gated "+
			"expectation instead of deleting the proof. got=%d body=%s", rr.Code, rr.Body.String())
	}
	var advanced struct {
		Part domain.PartInstance `json:"part"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &advanced); err != nil {
		t.Fatal(err)
	}
	if advanced.Part.RequiredOperations[0].Status != domain.PartOperationStatusCompleted {
		t.Fatalf("advance must have completed the first operation: %+v", advanced.Part.RequiredOperations[0])
	}

	// Poststate: the physical mutation is durable on the projects row and the
	// floor event log recorded the transition.
	var firstOpStatus string
	if err := fx.admin.QueryRow(ctx, `
		SELECT pi.elem->'required_operations'->0->>'status'
		FROM projects, jsonb_array_elements(part_instances) AS pi(elem)
		WHERE projects.id = $1 AND pi.elem->>'id' = $2`, fx.projectID, part.ID).
		Scan(&firstOpStatus); err != nil {
		t.Fatal(err)
	}
	if firstOpStatus != string(domain.PartOperationStatusCompleted) {
		t.Fatalf("poststate: persisted part shows first operation %q", firstOpStatus)
	}
	var floorEvents int
	if err := fx.admin.QueryRow(ctx, `
		SELECT COUNT(*) FROM project_item_floor_events WHERE project_id = $1`, fx.projectID).
		Scan(&floorEvents); err != nil {
		t.Fatal(err)
	}
	if floorEvents == 0 {
		t.Fatal("poststate: advance produced no floor event")
	}
	t.Logf("RED poststate: part=%s first operation completed, floor_events=%d — physical work "+
		"began with no engineering completion and no material authorization for release %s",
		part.ID, floorEvents, p1.Release.ID)
}

// legacy physical routes: item-level floor writers advance the quote-line
// item without resolving any release authority. Canonical units reference
// FurnitureInstance IDs, so the OC-033/034 split-brain guard (which compares
// unit.ProjectItemID against the project-item id) does not engage for these
// rows — the legacy writes succeed today. PR 2 must classify these writers:
// gate them or explicitly mark them administrative-only.
func TestEngineeringGateRed_LegacyItemFloorWritersAdvanceWithoutEngineering(t *testing.T) {
	fx := setupReleaseFixture(t)
	p1 := opsDt1CreateReleaseP1(t, fx)
	multiOrgExec(t, fx.admin, `ALTER TABLE projects DISABLE TRIGGER protect_project_organization_ownership;
 UPDATE projects SET manufacturing_organization_id=organization_id WHERE id='`+fx.projectID+`';
 ALTER TABLE projects ENABLE TRIGGER protect_project_organization_ownership;`)
	ctx := context.Background()
	call, token := engineeringGateRedHarness(t, fx, "engineering-gate-red-legacy-secret-012345")

	var itemID string
	if err := fx.admin.QueryRow(ctx, `
		SELECT id FROM project_items WHERE project_id = $1 ORDER BY id LIMIT 1`, fx.projectID).
		Scan(&itemID); err != nil {
		t.Fatal(err)
	}

	// Preparation: planned executions exist (units reference furniture
	// instances, NOT this quote-line item).
	if rr := call(http.MethodPut, "/api/projects/"+fx.projectID+"/part-executions", token, `{}`); rr.Code != 200 {
		t.Fatalf("planned generation=%d %s", rr.Code, rr.Body.String())
	}

	// Legacy writer 1: PATCH item floor-status.
	rr := call(http.MethodPatch, "/api/projects/"+fx.projectID+"/items/"+itemID+"/floor-status",
		token, `{"status":"cut"}`)
	t.Logf("RED floor-status: PATCH items/%s/floor-status -> %d %s", itemID, rr.Code, rr.Body.String())
	if rr.Code != 200 {
		t.Fatalf("documented RED: legacy floor-status is currently expected to succeed; "+
			"if it now fails, the gate landed — flip this assertion. got=%d body=%s", rr.Code, rr.Body.String())
	}

	// Legacy writer 2: POST floor-scan advancing the same item again.
	rr = call(http.MethodPost, "/api/projects/"+fx.projectID+"/floor-scan",
		token, `{"item_id":"`+itemID+`","advance":true}`)
	t.Logf("RED floor-scan: POST floor-scan -> %d %s", rr.Code, rr.Body.String())
	if rr.Code != 200 {
		t.Fatalf("documented RED: legacy floor-scan is currently expected to succeed; "+
			"if it now fails, the gate landed — flip this assertion. got=%d body=%s", rr.Code, rr.Body.String())
	}

	// Poststate: the quote-line item carries physical floor progress and the
	// floor event log recorded both transitions.
	var floorStatus string
	if err := fx.admin.QueryRow(ctx, `
		SELECT floor_status FROM project_items WHERE id = $1`, itemID).Scan(&floorStatus); err != nil {
		t.Fatal(err)
	}
	if floorStatus != "edged" {
		t.Fatalf("poststate: expected item advanced to edged, got %q", floorStatus)
	}
	t.Logf("RED poststate: quote-line item %s floor_status=%s with no engineering completion "+
		"and no material authorization for release %s", itemID, floorStatus, p1.Release.ID)
}
