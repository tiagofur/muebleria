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

// #740 — the operational physical gate, GREEN since PR 2.
//
// This file is the PR 1 RED scenario with its expectations INVERTED by the
// gate wiring (storage/physical_work_gate.go): with a valid Q/R/P context
// (P1 canonical, schema-v2 frozen routing) and NO durable Engineering
// completion nor material authorization for P1, every physical writer now
// fails closed with the actionable blocker and ZERO mutations. The scenario
// shape (fixture, prestate proofs, HTTP calls) is preserved verbatim from the
// RED so the before/after stays comparable — do not delete these proofs.
//
// Generation of PLANNED executions (PUT part-executions) is preparation, not
// physical work: it must keep working before Engineering completion (#739
// regression), and it still does — asserted here on the negative path.

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

// gateBlockedPayload asserts the 409 blocker carries the actionable copy.
func gateBlockedPayload(t *testing.T, rr *httptest.ResponseRecorder, wantFragment string) {
	t.Helper()
	if rr.Code != http.StatusConflict {
		t.Fatalf("gate must block with 409, got=%d body=%s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), wantFragment) {
		t.Fatalf("gate blocker must be actionable (%q), got=%s", wantFragment, rr.Body.String())
	}
}

// canonical physical route: one station completes one piece operation.
func TestEngineeringGate_PartAdvanceBlockedWithoutEngineeringCompletion(t *testing.T) {
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
		// "no durable engineering evidence" prestate this scenario documents.
		if !strings.Contains(err.Error(), "does not exist") {
			t.Fatal(err)
		}
		engineeringRows = 0
	}
	if engineeringRows != 0 {
		t.Fatalf("prestate: expected no durable engineering evidence for %s", p1.Release.ID)
	}
	t.Logf("gate scenario: release=%s (P%d, fp=%s) durable_engineering=none material_evidence=none actor=%s role=admin",
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
	// Gated behavior (#740 PR 2): 409 engineering pending, zero mutations.
	advancePath := "/api/projects/" + fx.projectID + "/parts/" + part.ID + "/advance"
	rr = call(http.MethodPost, advancePath, token, `{"operation_type":"cut","operator_name":"Gate Operator"}`)
	t.Logf("gated advance: POST %s -> %d %s", advancePath, rr.Code, rr.Body.String())
	gateBlockedPayload(t, rr, "Ingeniería pendiente")

	// Poststate: the piece is untouched on the projects row and no floor
	// event recorded any transition.
	var firstOpStatus string
	if err := fx.admin.QueryRow(ctx, `
		SELECT pi.elem->'required_operations'->0->>'status'
		FROM projects, jsonb_array_elements(part_instances) AS pi(elem)
		WHERE projects.id = $1 AND pi.elem->>'id' = $2`, fx.projectID, part.ID).
		Scan(&firstOpStatus); err != nil {
		t.Fatal(err)
	}
	if firstOpStatus != string(domain.PartOperationStatusQueued) {
		t.Fatalf("poststate: persisted part must keep its first operation queued, got %q", firstOpStatus)
	}
	var floorEvents int
	if err := fx.admin.QueryRow(ctx, `
		SELECT COUNT(*) FROM project_item_floor_events WHERE project_id = $1`, fx.projectID).
		Scan(&floorEvents); err != nil {
		t.Fatal(err)
	}
	if floorEvents != 0 {
		t.Fatalf("poststate: blocked advance must leave 0 floor events, got %d", floorEvents)
	}
	t.Logf("gated poststate: part=%s unchanged, floor_events=0 — physical work correctly requires "+
		"Engineering completion and material authorization for release %s", part.ID, p1.Release.ID)
}

// legacy physical routes: item-level floor writers advance the quote-line
// item without resolving any release authority. Canonical units reference
// FurnitureInstance IDs, so the OC-033/034 split-brain guard (which compares
// unit.ProjectItemID against the project-item id) does not engage for these
// rows. Since PR 2 both writers resolve the authority inside the gated
// atomic write (#740) and fail closed with zero mutations.
func TestEngineeringGate_LegacyItemFloorWritersBlockedWithoutEngineering(t *testing.T) {
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

	// Legacy writer 1: PATCH item floor-status — blocked by the gate.
	rr := call(http.MethodPatch, "/api/projects/"+fx.projectID+"/items/"+itemID+"/floor-status",
		token, `{"status":"cut"}`)
	t.Logf("gated floor-status: PATCH items/%s/floor-status -> %d %s", itemID, rr.Code, rr.Body.String())
	gateBlockedPayload(t, rr, "Ingeniería pendiente")

	// Legacy writer 2: POST floor-scan advancing the same item — also blocked.
	rr = call(http.MethodPost, "/api/projects/"+fx.projectID+"/floor-scan",
		token, `{"item_id":"`+itemID+`","advance":true}`)
	t.Logf("gated floor-scan: POST floor-scan -> %d %s", rr.Code, rr.Body.String())
	gateBlockedPayload(t, rr, "Ingeniería pendiente")

	// Poststate: the quote-line item carries no physical floor progress and
	// the floor event log recorded nothing.
	var floorStatus string
	if err := fx.admin.QueryRow(ctx, `
		SELECT COALESCE(floor_status, 'pending') FROM project_items WHERE id = $1`, itemID).Scan(&floorStatus); err != nil {
		t.Fatal(err)
	}
	if floorStatus != "pending" {
		t.Fatalf("poststate: blocked writers must leave the item pending, got %q", floorStatus)
	}
	var floorEvents int
	if err := fx.admin.QueryRow(ctx, `
		SELECT COUNT(*) FROM project_item_floor_events WHERE project_id = $1`, fx.projectID).
		Scan(&floorEvents); err != nil {
		t.Fatal(err)
	}
	if floorEvents != 0 {
		t.Fatalf("poststate: blocked writers must leave 0 floor events, got %d", floorEvents)
	}
	t.Logf("gated poststate: quote-line item %s pending, floor_events=0 — no engineering completion "+
		"and no material authorization for release %s", itemID, p1.Release.ID)
}
