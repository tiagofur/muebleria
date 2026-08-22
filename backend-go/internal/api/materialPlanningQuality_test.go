package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

/**
 * Material planning + quality endpoints (OC-050..OC-054, OC-060..OC-062,
 * issue #302): requirements from the released BOM, reservation caps, the
 * evidence-backed release gates with audited override, quality issues with
 * physical rework effects and the per-unit QC records.
 */

func materialsFixtures() (*stubStore, *Server) {
	releasedAt := time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC)
	release := &domain.ProductionRelease{
		ID: "rel-1", ProjectID: "p1", ProjectVersion: 1, DesignRevisionID: "dr-1",
		BOMFingerprint: "fp-abc123", ReleasedBy: "ing-1", ReleasedAt: releasedAt,
	}
	store := &stubStore{
		productionRelease: release,
		materialStock: []domain.MaterialStock{
			{Kind: "herrajes", MaterialID: "hw-1", Quantity: 12, MinStock: 2},
		},
	}
	return store, &Server{Store: store}
}

func doMaterials(srv *Server, method, path, role, body string) *httptest.ResponseRecorder {
	req := withClaims(httptest.NewRequest(method, path, strings.NewReader(body)), "u1", role)
	req.SetPathValue("id", "p1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	switch {
	case strings.HasSuffix(path, "/materials/derive"):
		srv.HandleMaterialsDerive(rr, req)
	case strings.HasSuffix(path, "/materials/reserve"):
		srv.HandleMaterialsReserve(rr, req)
	case strings.HasSuffix(path, "/materials/release"):
		srv.HandleMaterialsRelease(rr, req)
	default:
		srv.HandleProjectMaterials(rr, req)
	}
	return rr
}

func TestMaterials_DeriveBindsReleaseAndAudits(t *testing.T) {
	store, srv := materialsFixtures()
	rr := doMaterials(srv, http.MethodPost, "/api/projects/p1/materials/derive", string(domain.RoleAlmacen),
		`{"lines":[{"kind":"herrajes","material_id":"hw-1","quantity":10}]}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("derive = %d body %s", rr.Code, rr.Body.String())
	}
	if store.materialPlanning == nil || store.materialPlanning.Requirements == nil {
		t.Fatal("derive must persist the requirements snapshot")
	}
	if store.materialPlanning.Requirements.ReleaseID != "rel-1" ||
		store.materialPlanning.Requirements.BomFingerprint != "fp-abc123" {
		t.Fatalf("requirements must bind to the production release: %+v", store.materialPlanning.Requirements)
	}
	if len(store.materialPlanningEvents) != 1 || store.materialPlanningEvents[0].Type != "materials_required" {
		t.Fatalf("derive must audit materials_required: %+v", store.materialPlanningEvents)
	}
}

func TestMaterials_DeriveRequiresProductionRelease(t *testing.T) {
	store, srv := materialsFixtures()
	store.productionRelease = nil
	rr := doMaterials(srv, http.MethodPost, "/api/projects/p1/materials/derive", string(domain.RoleAlmacen),
		`{"lines":[{"kind":"herrajes","material_id":"hw-1","quantity":10}]}`)
	if rr.Code != http.StatusConflict {
		t.Fatalf("without production release derive must 409, got %d", rr.Code)
	}
}

func TestMaterials_DeriveForbiddenForVendedor(t *testing.T) {
	_, srv := materialsFixtures()
	rr := doMaterials(srv, http.MethodPost, "/api/projects/p1/materials/derive", string(domain.RoleVendedor),
		`{"lines":[{"kind":"herrajes","material_id":"hw-1","quantity":10}]}`)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("vendedor must not derive requirements, got %d", rr.Code)
	}
}

func TestMaterials_ReserveCapsAndAuditsShortage(t *testing.T) {
	store, srv := materialsFixtures()
	if rr := doMaterials(srv, http.MethodPost, "/api/projects/p1/materials/derive", string(domain.RoleAlmacen),
		`{"lines":[{"kind":"herrajes","material_id":"hw-1","quantity":20}]}`); rr.Code != http.StatusOK {
		t.Fatalf("derive = %d body %s", rr.Code, rr.Body.String())
	}
	rr := doMaterials(srv, http.MethodPost, "/api/projects/p1/materials/reserve", string(domain.RoleAlmacen), `{}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("reserve = %d body %s", rr.Code, rr.Body.String())
	}
	var resp struct {
		ReservedLines []domain.ReserveLine `json:"reserved_lines"`
		ShortLines    []domain.ReserveLine `json:"short_lines"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if len(resp.ReservedLines) != 1 || resp.ReservedLines[0].Quantity != 12 {
		t.Fatalf("reserve must cap at onHand: %+v", resp.ReservedLines)
	}
	if len(resp.ShortLines) != 1 || resp.ShortLines[0].Quantity != 8 {
		t.Fatalf("remainder is shortage: %+v", resp.ShortLines)
	}
	types := map[string]bool{}
	for _, ev := range store.materialPlanningEvents {
		types[ev.Type] = true
	}
	if !types["materials_reserved"] || !types["materials_shortage_detected"] {
		t.Fatalf("reserve must audit both events: %+v", store.materialPlanningEvents)
	}
}

func TestMaterials_ReleaseGatesAndOverrideAudit(t *testing.T) {
	store, srv := materialsFixtures()
	if rr := doMaterials(srv, http.MethodPost, "/api/projects/p1/materials/derive", string(domain.RoleAlmacen),
		`{"lines":[{"kind":"herrajes","material_id":"hw-1","quantity":10}]}`); rr.Code != http.StatusOK {
		t.Fatalf("derive = %d", rr.Code)
	}

	// Without reservations the gates fail: release must 409 with the checks.
	rr := doMaterials(srv, http.MethodPost, "/api/projects/p1/materials/release", string(domain.RoleAlmacen), `{}`)
	if rr.Code != http.StatusConflict {
		t.Fatalf("release without evidence must 409, got %d body %s", rr.Code, rr.Body.String())
	}
	var blocked struct {
		ReleaseChecks []domain.MaterialsReleaseCheck `json:"release_checks"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &blocked)
	anyFailing := false
	for _, c := range blocked.ReleaseChecks {
		if c.Required && !c.Passed {
			anyFailing = true
		}
	}
	if len(blocked.ReleaseChecks) == 0 || !anyFailing {
		t.Fatalf("409 must carry failing checks: %+v", blocked.ReleaseChecks)
	}

	// Override audits materials_release_overridden before materials_ready and
	// stamps the processStage release.
	rr = doMaterials(srv, http.MethodPost, "/api/projects/p1/materials/release", string(domain.RoleAdmin),
		`{"override_reason":"Cliente trae herrajes propios"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("override release = %d body %s", rr.Code, rr.Body.String())
	}
	if !store.materialsReleased {
		t.Fatal("release must stamp projects.materials_release")
	}
	types := []string{}
	for _, ev := range store.materialPlanningEvents {
		types = append(types, ev.Type)
	}
	if !containsStr(types, "materials_release_overridden") || !containsStr(types, "materials_ready") {
		t.Fatalf("override must audit both events: %v", types)
	}
	if store.materialPlanning.Release == nil || store.materialPlanning.Release.Override == nil {
		t.Fatal("override evidence must be recorded on the planning")
	}

	// Second release is rejected.
	rr = doMaterials(srv, http.MethodPost, "/api/projects/p1/materials/release", string(domain.RoleAdmin), `{}`)
	if rr.Code != http.StatusConflict {
		t.Fatalf("second release must 409, got %d", rr.Code)
	}
}

func TestMaterials_ReleaseWithFullEvidence(t *testing.T) {
	store, srv := materialsFixtures()
	if rr := doMaterials(srv, http.MethodPost, "/api/projects/p1/materials/derive", string(domain.RoleAlmacen),
		`{"lines":[{"kind":"herrajes","material_id":"hw-1","quantity":10}]}`); rr.Code != http.StatusOK {
		t.Fatalf("derive = %d", rr.Code)
	}
	if rr := doMaterials(srv, http.MethodPost, "/api/projects/p1/materials/reserve", string(domain.RoleAlmacen), `{}`); rr.Code != http.StatusOK {
		t.Fatalf("reserve = %d", rr.Code)
	}
	rr := doMaterials(srv, http.MethodPost, "/api/projects/p1/materials/release", string(domain.RoleAlmacen), `{}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("evidence-backed release = %d body %s", rr.Code, rr.Body.String())
	}
	if store.materialPlanning.Release != nil && store.materialPlanning.Release.Override != nil {
		t.Fatal("full evidence must not record an override")
	}
	// Reservations moved to released.
	for _, r := range store.materialPlanning.Reservations {
		if r.Status != domain.MaterialReservationReleased {
			t.Fatalf("reservations must be released: %+v", r)
		}
	}
}

func TestMaterials_ConsumeOnPickingDispatch(t *testing.T) {
	store, srv := materialsFixtures()
	if rr := doMaterials(srv, http.MethodPost, "/api/projects/p1/materials/derive", string(domain.RoleAlmacen),
		`{"lines":[{"kind":"herrajes","material_id":"hw-1","quantity":10}]}`); rr.Code != http.StatusOK {
		t.Fatalf("derive = %d", rr.Code)
	}
	if rr := doMaterials(srv, http.MethodPost, "/api/projects/p1/materials/reserve", string(domain.RoleAlmacen), `{}`); rr.Code != http.StatusOK {
		t.Fatalf("reserve = %d", rr.Code)
	}

	// Despacho de picking: consume las reservas activas de la obra.
	rr := doMaterialsConsume(srv, string(domain.RoleAlmacen),
		`{"lines":[{"kind":"herrajes","material_id":"hw-1","quantity":10}]}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("consume = %d body %s", rr.Code, rr.Body.String())
	}
	reservations := store.materialPlanning.Reservations
	if len(reservations) != 1 || reservations[0].Status != domain.MaterialReservationConsumed || reservations[0].ConsumedAt == nil {
		t.Fatalf("picking dispatch must consume the reservation: %+v", reservations)
	}
	// La cobertura sigue cubierta (consumido = entregado a la obra) y el
	// release está listo sin faltantes.
	if rr := doMaterials(srv, http.MethodPost, "/api/projects/p1/materials/release", string(domain.RoleAlmacen), `{}`); rr.Code != http.StatusOK {
		t.Fatalf("release after consume = %d body %s", rr.Code, rr.Body.String())
	}
}

func doMaterialsConsume(srv *Server, role, body string) *httptest.ResponseRecorder {
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects/p1/materials/consume", strings.NewReader(body)), "u1", role)
	req.SetPathValue("id", "p1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleMaterialsConsume(rr, req)
	return rr
}

func containsStr(list []string, target string) bool {
	for _, v := range list {
		if v == target {
			return true
		}
	}
	return false
}

/* ── Quality endpoints ────────────────────────────────────────────────────── */

func qualityFixtures() (*stubStore, *Server) {
	part := domain.PartInstance{
		ID: "p1_i1_u1_LAT_1", ProjectID: "p1", ProductionRevision: "rel-1", ProjectItemID: "i1",
		UnitIndex: 1, PartCode: "LAT-1", Description: "Lateral", MaterialID: "board-1",
		LengthMm: 800, WidthMm: 600, ThicknessMm: 18,
		RequiredOperations: []domain.PartOperation{
			{ID: "op-1", Type: domain.PartOperationCut, Sequence: 1, Status: domain.PartOperationStatusCompleted},
			{ID: "op-2", Type: domain.PartOperationEdgeBanding, Sequence: 2, Status: domain.PartOperationStatusCompleted},
		},
		CurrentOperationIndex: 1, Status: domain.PartInstanceStatusReadyForAssembly,
	}
	unit := domain.ModuleUnitExecution{
		ID: "p1_i1_u1", ProjectID: "p1", ProjectItemID: "i1", UnitIndex: 1,
		ProductionRevision: "rel-1", Status: domain.ModuleUnitStatusModuleQC,
	}
	store := &stubStore{
		partInstances: []domain.PartInstance{part},
		moduleUnits:   []domain.ModuleUnitExecution{unit},
		releasedRevision: "rel-1",
	}
	return store, &Server{Store: store}
}

func doQuality(srv *Server, method, path, role, body string) *httptest.ResponseRecorder {
	return doQualityIssue(srv, method, path, role, body, "qiss-1")
}

func doQualityIssue(srv *Server, method, path, role, body, issueID string) *httptest.ResponseRecorder {
	req := withClaims(httptest.NewRequest(method, path, strings.NewReader(body)), "u1", role)
	req.SetPathValue("id", "p1")
	if strings.Contains(path, "/issue/") && strings.HasSuffix(path, "/transition") {
		req.SetPathValue("issueId", issueID)
	}
	if strings.Contains(path, "/qc/") {
		req.SetPathValue("unitId", "p1_i1_u1")
	}
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	switch {
	case strings.HasSuffix(path, "/quality/issue"):
		srv.HandleQualityIssue(rr, req)
	case strings.HasSuffix(path, "/transition"):
		srv.HandleQualityIssueTransition(rr, req)
	case strings.HasSuffix(path, "/quality/rework"):
		srv.HandleQualityRework(rr, req)
	case strings.HasSuffix(path, "/override"):
		srv.HandleQualityUnitQcOverride(rr, req)
	case strings.HasSuffix(path, "/qc/p1_i1_u1"):
		srv.HandleQualityUnitQc(rr, req)
	default:
		srv.HandleProjectQuality(rr, req)
	}
	return rr
}

func reportTestIssue(t *testing.T, store *stubStore, srv *Server) {
	t.Helper()
	rr := doQuality(srv, http.MethodPost, "/api/projects/p1/quality/issue", string(domain.RoleProduccion),
		`{"description":"Canto despegado","category":"acabado_canto","part_instance_id":"p1_i1_u1_LAT_1","module_unit_id":"p1_i1_u1"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("issue = %d body %s", rr.Code, rr.Body.String())
	}
	if store.qualityJob == nil || len(store.qualityJob.Issues) != 1 {
		t.Fatal("issue must be recorded on the quality job")
	}
	if len(store.qualityEvents) != 1 || store.qualityEvents[0].Type != "quality_issue_reported" {
		t.Fatalf("issue must audit quality_issue_reported: %+v", store.qualityEvents)
	}
}

func TestQuality_ReportIssueAndTransition(t *testing.T) {
	store, srv := qualityFixtures()
	reportTestIssue(t, store, srv)

	issueID := store.qualityJob.Issues[0].ID
	rr := doQualityIssue(srv, http.MethodPost, "/api/projects/p1/quality/issue/"+issueID+"/transition", string(domain.RoleProduccion),
		`{"to_status":"resolved","notes":"Pegado de nuevo"}`, issueID)
	if rr.Code != http.StatusOK {
		t.Fatalf("transition = %d body %s", rr.Code, rr.Body.String())
	}
	if store.qualityJob.Issues[0].Status != domain.QualityIssueResolved {
		t.Fatalf("issue must be resolved: %+v", store.qualityJob.Issues[0])
	}

	// Illegal jump resolved → open? that's legal (failed verification). But
	// open → verified must be rejected.
	rr = doQualityIssue(srv, http.MethodPost, "/api/projects/p1/quality/issue/"+issueID+"/transition", string(domain.RoleProduccion),
		`{"to_status":"verified"}`, issueID)
	if rr.Code != http.StatusOK {
		t.Fatalf("resolved → verified = %d", rr.Code)
	}
}

func TestQuality_ReworkAppliesPhysicalEffectAndCosting(t *testing.T) {
	store, srv := qualityFixtures()
	reportTestIssue(t, store, srv)

	rr := doQualityIssue(srv, http.MethodPost, "/api/projects/p1/quality/rework", string(domain.RoleGerenteProduccion),
		`{"issue_id":"`+store.qualityJob.Issues[0].ID+`","action":"rework","reason":"Canto mal pegado","material_cost":25.5,"labor_minutes":30,"part_instance_id":"p1_i1_u1_LAT_1","target_operation":"edge_banding"}`, store.qualityJob.Issues[0].ID)
	if rr.Code != http.StatusOK {
		t.Fatalf("rework = %d body %s", rr.Code, rr.Body.String())
	}
	if store.qualityJob.Issues[0].Status != domain.QualityIssueResolved {
		t.Fatal("rework resolves the issue")
	}
	if len(store.qualityJob.ReworkActions) != 1 || store.qualityJob.ReworkActions[0].MaterialCost != 25.5 {
		t.Fatalf("rework action with costing: %+v", store.qualityJob.ReworkActions)
	}
	var edgeOp *domain.PartOperation
	for i := range store.partInstances[0].RequiredOperations {
		if store.partInstances[0].RequiredOperations[i].Type == domain.PartOperationEdgeBanding {
			edgeOp = &store.partInstances[0].RequiredOperations[i]
		}
	}
	if edgeOp == nil || edgeOp.Status != domain.PartOperationStatusRework {
		t.Fatalf("rework must reopen the edge operation: %+v", edgeOp)
	}
	found := false
	for _, ev := range store.qualityEvents {
		if ev.Type == "rework_started" {
			found = true
		}
	}
	if !found {
		t.Fatal("rework must audit rework_started")
	}
}

func TestQuality_ScrapMarksPieceScrapped(t *testing.T) {
	store, srv := qualityFixtures()
	reportTestIssue(t, store, srv)
	rr := doQualityIssue(srv, http.MethodPost, "/api/projects/p1/quality/rework", string(domain.RoleProduccion),
		`{"issue_id":"`+store.qualityJob.Issues[0].ID+`","action":"scrap","material_cost":300,"part_instance_id":"p1_i1_u1_LAT_1"}`, store.qualityJob.Issues[0].ID)
	if rr.Code != http.StatusOK {
		t.Fatalf("scrap = %d body %s", rr.Code, rr.Body.String())
	}
	if store.partInstances[0].Status != domain.PartInstanceStatusScrapped {
		t.Fatalf("scrap must mark the piece scrapped, got %s", store.partInstances[0].Status)
	}
}

func TestQuality_UnitQcChecklistAndOverride(t *testing.T) {
	store, srv := qualityFixtures()
	rr := doQuality(srv, http.MethodPost, "/api/projects/p1/quality/qc/p1_i1_u1", string(domain.RoleProduccion),
		`{"checklist":[{"code":"square","passed":true},{"code":"dimensions","passed":true},{"code":"hardware","passed":true},{"code":"doors_drawers","passed":true},{"code":"finish","passed":true},{"code":"identification","passed":true}]}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("qc = %d body %s", rr.Code, rr.Body.String())
	}
	if store.qualityJob.UnitQC[0].PassedAt == nil {
		t.Fatal("full checklist must pass the unit")
	}

	// Failing checklist keeps the gate closed.
	store2, srv2 := qualityFixtures()
	rr = doQuality(srv2, http.MethodPost, "/api/projects/p1/quality/qc/p1_i1_u1", string(domain.RoleProduccion),
		`{"checklist":[{"code":"square","passed":false}]}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("qc failing = %d", rr.Code)
	}
	if store2.qualityJob.UnitQC[0].PassedAt != nil {
		t.Fatal("failing checklist must not pass the unit")
	}

	// Override is supervisor-only.
	rr = doQuality(srv, http.MethodPost, "/api/projects/p1/quality/qc/p1_i1_u1/override", string(domain.RoleProduccion),
		`{"reason":"urgente"}`)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("produccion cannot override QC, got %d", rr.Code)
	}
	rr = doQuality(srv, http.MethodPost, "/api/projects/p1/quality/qc/p1_i1_u1/override", string(domain.RoleAdmin),
		`{"reason":"Despacho urgente acordado con gerencia"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("override = %d body %s", rr.Code, rr.Body.String())
	}
	if store.qualityJob.UnitQC[0].Override == nil {
		t.Fatal("override must be recorded")
	}
}
