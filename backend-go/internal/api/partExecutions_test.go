package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

/**
 * Physical execution endpoints (OC-030..OC-034, #301): sequence guard,
 * convergence gate with stale revision, supervisor override, rework audit,
 * RBAC and the legacy split-brain guard.
 */

func partExecFixtures(releasedRevision string) (*stubStore, *Server) {
	unit := domain.ModuleUnitExecution{
		ID: "p1_i1_u1", ProjectID: "p1", ProjectItemID: "i1", UnitIndex: 1,
		ProductionRevision: releasedRevision, Status: domain.ModuleUnitStatusAwaitingParts,
	}
	lat := domain.PartInstance{
		ID: "p1_i1_u1_LAT_1", ProjectID: "p1", ProductionRevision: releasedRevision,
		ProjectItemID: "i1", UnitIndex: 1, PartCode: "LAT", MaterialID: "mat-1",
		RequiredOperations: []domain.PartOperation{
			{ID: "op1", Type: domain.PartOperationCut, Sequence: 1, Status: domain.PartOperationStatusQueued},
		},
		Status: domain.PartInstanceStatusPending,
	}
	project := &domain.Project{
		ID: "p1", Name: "Obra Test", CustomerID: "c1", Status: domain.StatusAccepted,
		Items: []domain.ProjectItem{{ID: "i1", ModuleID: "m-gab", Quantity: 1}},
	}
	if releasedRevision != "" {
		project.ProductionRelease = &domain.ProductionRelease{ID: releasedRevision, ProjectID: "p1"}
	}
	project.PartInstances = []domain.PartInstance{lat}
	project.ModuleUnits = []domain.ModuleUnitExecution{unit}
	store := &stubStore{
		projectReturnedByID: project,
		partInstances:       []domain.PartInstance{lat},
		moduleUnits:         []domain.ModuleUnitExecution{unit},
		itemFloorStatuses:   map[string]string{"i1": "pending"},
	}
	return store, &Server{Store: store}
}

func doPartExec(srv *Server, method, path, role, body string) *httptest.ResponseRecorder {
	req := withClaims(httptest.NewRequest(method, path, strings.NewReader(body)), "u1", role)
	req.SetPathValue("id", "p1")
	if strings.Contains(path, "/parts/") {
		req.SetPathValue("partId", "p1_i1_u1_LAT_1")
	}
	if strings.Contains(path, "/units/") {
		req.SetPathValue("unitId", "p1_i1_u1")
	}
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	switch {
	case strings.HasSuffix(path, "/advance") && strings.Contains(path, "/parts/"):
		srv.HandleAdvancePartOperation(rr, req)
	case strings.HasSuffix(path, "/rework"):
		srv.HandlePartRework(rr, req)
	case strings.HasSuffix(path, "/advance"):
		srv.HandleAdvanceModuleUnit(rr, req)
	case strings.HasSuffix(path, "/assembly-override"):
		srv.HandleAssemblyOverride(rr, req)
	default:
		srv.HandleProjectPartExecutions(rr, req)
	}
	return rr
}

func TestPartExec_AdvanceCutDerivesLegacyStatusAndAudits(t *testing.T) {
	store, srv := partExecFixtures("rev-1")
	rr := doPartExec(srv, http.MethodPost, "/api/projects/p1/parts/p1_i1_u1_LAT_1/advance",
		string(domain.RoleProduccion), `{"operation_type":"cut","operator_name":"Juan"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Part *domain.PartInstance `json:"part"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	if resp.Part.Status != domain.PartInstanceStatusReadyForAssembly {
		t.Fatalf("single cut op must finish the piece, got %s", resp.Part.Status)
	}
	// OC-034 bridge: derived legacy status persisted + floor event audited.
	if got := store.mutateFloorEvents; len(got) != 1 || got[0].From != "pending" || got[0].To != "edged" {
		t.Fatalf("expected floor event pending→edged, got %+v", got)
	}
	if store.itemFloorStatuses["i1"] != "edged" && store.partInstances[0].Status != domain.PartInstanceStatusReadyForAssembly {
		t.Fatalf("state not persisted")
	}
}

func TestPartExec_AdvanceRejectsOutOfSequence(t *testing.T) {
	_, srv := partExecFixtures("rev-1")
	// Route has only cut; edge_banding does not exist for this piece.
	rr := doPartExec(srv, http.MethodPost, "/api/projects/p1/parts/p1_i1_u1_LAT_1/advance",
		string(domain.RoleAdmin), `{"operation_type":"cnc"}`)
	if rr.Code != http.StatusConflict {
		t.Fatalf("expected 409 for unavailable operation, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestPartExec_AssemblyGateBlocksAndReportsMissingPieces(t *testing.T) {
	store, srv := partExecFixtures("rev-1")
	rr := doPartExec(srv, http.MethodPost, "/api/projects/p1/units/p1_i1_u1/advance",
		string(domain.RoleProduccion), `{"advance":true}`)
	if rr.Code != http.StatusConflict {
		t.Fatalf("expected 409 from assembly gate, got %d body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		AssemblyReadiness domain.AssemblyReadiness `json:"assembly_readiness"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	if resp.AssemblyReadiness.IsReady || resp.AssemblyReadiness.ReadyPieces != 0 || resp.AssemblyReadiness.TotalPieces != 1 {
		t.Fatalf("gate must report the missing piece, got %+v", resp.AssemblyReadiness)
	}
	if store.moduleUnits[0].Status != domain.ModuleUnitStatusAwaitingParts {
		t.Fatal("unit must stay awaiting_parts when blocked")
	}
}

func TestPartExec_StaleRevisionBlocksAssemblyUntilOverride(t *testing.T) {
	store, srv := partExecFixtures("rev-2") // unit/pieces generated at rev-2…
	// …but released revision moves to rev-9 via a fresh release.
	store.projectReturnedByID.ProductionRelease.ID = "rev-9"
	// finish the piece
	if _, changed := domain.AdvancePartOperation(store.partInstances[0], domain.PartOperationCut, domain.OperatorDetails{}); changed {
		store.partInstances[0], _ = domain.AdvancePartOperation(store.partInstances[0], domain.PartOperationCut, domain.OperatorDetails{})
	}
	rr := doPartExec(srv, http.MethodPost, "/api/projects/p1/units/p1_i1_u1/advance",
		string(domain.RoleAdmin), `{"advance":true}`)
	if rr.Code != http.StatusConflict {
		t.Fatalf("stale revision must block assembly, got %d body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		AssemblyReadiness domain.AssemblyReadiness `json:"assembly_readiness"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if len(resp.AssemblyReadiness.Blockers) == 0 {
		t.Fatal("stale revision must produce a blocker")
	}

	// Supervisor override unblocks the gate.
	rrOverride := doPartExec(srv, http.MethodPost, "/api/projects/p1/units/p1_i1_u1/assembly-override",
		string(domain.RoleGerenteProduccion), `{"reason":"cambio no afecta estructuras"}`)
	if rrOverride.Code != http.StatusOK {
		t.Fatalf("override expected 200, got %d body=%s", rrOverride.Code, rrOverride.Body.String())
	}
	rrAfter := doPartExec(srv, http.MethodPost, "/api/projects/p1/units/p1_i1_u1/advance",
		string(domain.RoleProduccion), `{"advance":true}`)
	if rrAfter.Code != http.StatusOK {
		t.Fatalf("assembly after override expected 200, got %d body=%s", rrAfter.Code, rrAfter.Body.String())
	}
	if store.moduleUnits[0].Status != domain.ModuleUnitStatusAssembly || store.moduleUnits[0].SupervisorOverride == nil {
		t.Fatalf("unit must be in assembly with audited override, got %+v", store.moduleUnits[0])
	}
}

func TestPartExec_OverrideRequiresSupervisor(t *testing.T) {
	_, srv := partExecFixtures("rev-1")
	rr := doPartExec(srv, http.MethodPost, "/api/projects/p1/units/p1_i1_u1/assembly-override",
		string(domain.RoleProduccion), `{"reason":"porque sí"}`)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("scoped operator must not override, got %d", rr.Code)
	}
}

func TestPartExec_UnitRejectsInvalidTransition(t *testing.T) {
	store, srv := partExecFixtures("rev-1")
	rr := doPartExec(srv, http.MethodPost, "/api/projects/p1/units/p1_i1_u1/advance",
		string(domain.RoleAdmin), `{"target_status":"packaged"}`)
	if rr.Code != http.StatusConflict {
		t.Fatalf("jump awaiting_parts→packaged must be 409, got %d", rr.Code)
	}
	if store.moduleUnits[0].Status != domain.ModuleUnitStatusAwaitingParts {
		t.Fatal("unit must be unchanged")
	}
}

func TestPartExec_ReworkEmitsQualityAndReworkEvents(t *testing.T) {
	store, srv := partExecFixtures("rev-1")
	rr := doPartExec(srv, http.MethodPost, "/api/projects/p1/parts/p1_i1_u1_LAT_1/rework",
		string(domain.RoleGerenteProduccion), `{"action":"refabricate","reason":"se partió en armado"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
	if store.partInstances[0].Status != domain.PartInstanceStatusPending {
		t.Fatalf("refabricate must reset the piece, got %s", store.partInstances[0].Status)
	}
	types := map[string]bool{}
	for _, ev := range store.projectEventWrites {
		types[ev.Type] = true
	}
	if !types["quality_issue_reported"] || !types["rework_started"] {
		t.Fatalf("expected quality_issue_reported + rework_started events, got %+v", store.projectEventWrites)
	}
}

func TestPartExec_RbacRejectsVendedor(t *testing.T) {
	_, srv := partExecFixtures("rev-1")
	rr := doPartExec(srv, http.MethodPost, "/api/projects/p1/parts/p1_i1_u1_LAT_1/advance",
		string(domain.RoleVendedor), `{"operation_type":"cut"}`)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("vendedor must be rejected, got %d", rr.Code)
	}
}

func TestPartExec_LegacyEndpointsRejectItemsWithUnits(t *testing.T) {
	store, srv := partExecFixtures("rev-1")

	// PATCH item floor-status → 409 split-brain guard
	req := withClaims(httptest.NewRequest(http.MethodPatch, "/api/projects/p1/items/i1/floor-status",
		strings.NewReader(`{"status":"cut"}`)), "u1", string(domain.RoleProduccion))
	req.SetPathValue("id", "p1")
	req.SetPathValue("itemId", "i1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleProjectItemFloorStatus(rr, req)
	if rr.Code != http.StatusConflict {
		t.Fatalf("legacy PATCH must 409 for unit-tracked items, got %d body=%s", rr.Code, rr.Body.String())
	}

	// floor-scan → same guard
	scanReq := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects/p1/floor-scan",
		strings.NewReader(`{"module":"m-gab","advance":true}`)), "u1", string(domain.RoleProduccion))
	scanReq.SetPathValue("id", "p1")
	scanReq.Header.Set("Content-Type", "application/json")
	scanRR := httptest.NewRecorder()
	srv.HandleProjectFloorScan(scanRR, scanReq)
	if scanRR.Code != http.StatusConflict {
		t.Fatalf("floor-scan must 409 for unit-tracked items, got %d body=%s", scanRR.Code, scanRR.Body.String())
	}
	_ = store
}

func TestPartExec_GetReadinessIncludesReleasedRevision(t *testing.T) {
	_, srv := partExecFixtures("rev-1")
	rr := doPartExec(srv, http.MethodGet, "/api/projects/p1/part-executions", string(domain.RoleProduccion), "")
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		PartInstances     []domain.PartInstance        `json:"part_instances"`
		ModuleUnits       []domain.ModuleUnitExecution `json:"module_units"`
		AssemblyReadiness []domain.AssemblyReadiness   `json:"assembly_readiness"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	if len(resp.PartInstances) != 1 || len(resp.ModuleUnits) != 1 || len(resp.AssemblyReadiness) != 1 {
		t.Fatalf("expected 1 piece, 1 unit, 1 readiness, got %d/%d/%d",
			len(resp.PartInstances), len(resp.ModuleUnits), len(resp.AssemblyReadiness))
	}
}

// ── Generation (PUT part-executions) ────────────────────────────────────────

func generateBody(revision string, quantity int) generatePartExecutionsRequest {
	units := make([]domain.ModuleUnitExecution, 0, quantity)
	for u := 1; u <= quantity; u++ {
		units = append(units, domain.ModuleUnitExecution{
			ID: fmt.Sprintf("p1_i1_u%d", u), ProjectID: "p1", ProjectItemID: "i1", UnitIndex: u,
			ProductionRevision: revision, Status: domain.ModuleUnitStatusAwaitingParts,
		})
	}
	return generatePartExecutionsRequest{
		PartInstances: []domain.PartInstance{{
			ID: "p1_i1_u1_LAT_1", ProjectID: "p1", ProductionRevision: revision,
			ProjectItemID: "i1", UnitIndex: 1, PartCode: "LAT", MaterialID: "mat-1",
			RequiredOperations: []domain.PartOperation{
				{ID: "op1", Type: domain.PartOperationCut, Sequence: 1, Status: domain.PartOperationStatusQueued},
			},
			Status: domain.PartInstanceStatusPending,
		}},
		ModuleUnits: units,
	}
}

func doGenerate(srv *Server, role string, body generatePartExecutionsRequest) *httptest.ResponseRecorder {
	raw, _ := json.Marshal(body)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/projects/p1/part-executions",
		strings.NewReader(string(raw))), "u1", role)
	req.SetPathValue("id", "p1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleGeneratePartExecutions(rr, req)
	return rr
}

func TestPartExec_GenerateValidatesAndPersists(t *testing.T) {
	store, srv := partExecFixtures("rev-1")
	store.partInstances = nil
	store.moduleUnits = nil
	store.itemQuantities = map[string]int{"i1": 2}

	rr := doGenerate(srv, string(domain.RoleGerenteProduccion), generateBody("rev-1", 2))
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
	if len(store.moduleUnits) != 2 || len(store.partInstances) != 1 {
		t.Fatalf("expected 2 units + 1 part persisted, got %d/%d", len(store.moduleUnits), len(store.partInstances))
	}
}

func TestPartExec_GenerateRejectsWrongUnitCount(t *testing.T) {
	store, srv := partExecFixtures("rev-1")
	store.partInstances = nil
	store.moduleUnits = nil
	store.itemQuantities = map[string]int{"i1": 3}

	rr := doGenerate(srv, string(domain.RoleAdmin), generateBody("rev-1", 2))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("quantity mismatch must 400, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestPartExec_GenerateRejectsStaleRevision(t *testing.T) {
	store, srv := partExecFixtures("rev-1")
	store.partInstances = nil
	store.moduleUnits = nil
	store.itemQuantities = map[string]int{"i1": 2}

	rr := doGenerate(srv, string(domain.RoleAdmin), generateBody("rev-old", 2))
	if rr.Code != http.StatusConflict {
		t.Fatalf("stale revision must 409, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestPartExec_GenerateRequiresForceOverProgress(t *testing.T) {
	store, srv := partExecFixtures("rev-1")
	store.itemQuantities = map[string]int{"i1": 1}
	// existing piece already advanced
	store.partInstances[0].RequiredOperations[0].Status = domain.PartOperationStatusCompleted
	store.partInstances[0].Status = domain.PartInstanceStatusReadyForAssembly

	rr := doGenerate(srv, string(domain.RoleAdmin), generateBody("rev-1", 1))
	if rr.Code != http.StatusConflict {
		t.Fatalf("progress without force must 409, got %d", rr.Code)
	}

	rrForce := doGenerate(srv, string(domain.RoleAdmin), generateBody("rev-1", 1))
	_ = rrForce
	// With force the regeneration succeeds and audits the reset.
	forced := generateBody("rev-1", 1)
	forced.Force = true
	rrOK := doGenerate(srv, string(domain.RoleAdmin), forced)
	if rrOK.Code != http.StatusOK {
		t.Fatalf("force regeneration must 200, got %d body=%s", rrOK.Code, rrOK.Body.String())
	}
	if store.partInstances[0].Status != domain.PartInstanceStatusPending {
		t.Fatal("forced regeneration must reset piece progress")
	}
	resetAudited := false
	for _, ev := range store.mutateFloorEvents {
		if ev.To == "pending" && strings.Contains(ev.Note, "Regeneración") {
			resetAudited = true
		}
	}
	if !resetAudited {
		t.Fatalf("forced regeneration must audit the reset via floor events, got %+v", store.mutateFloorEvents)
	}
}

// ── Scanner mode + bulto + costing ─────────────────────────────────────────

func TestPartExec_ScannerAdvanceResolvesCurrentOperation(t *testing.T) {
	_, srv := partExecFixtures("rev-1")
	rr := doPartExec(srv, http.MethodPost, "/api/projects/p1/parts/p1_i1_u1_LAT_1/advance",
		string(domain.RoleProduccion), `{"advance":true}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Part *domain.PartInstance `json:"part"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp.Part == nil || resp.Part.RequiredOperations[0].Status != domain.PartOperationStatusCompleted {
		t.Fatal("scanner advance must complete the current (cut) operation")
	}
}

func TestPartExec_UnitAdvanceRecordsPackageCount(t *testing.T) {
	store, srv := partExecFixtures("rev-1")
	// finish the piece and walk the unit to module_qc → packaged with 3 bultos
	store.partInstances[0].Status = domain.PartInstanceStatusReadyForAssembly
	store.partInstances[0].RequiredOperations[0].Status = domain.PartOperationStatusCompleted
	store.moduleUnits[0].Status = domain.ModuleUnitStatusModuleQC
	// QC gate (OC-062): packaging requires an approved per-unit checklist.
	passedAt := time.Date(2026, 8, 21, 11, 0, 0, 0, time.UTC)
	store.qualityJob = &domain.QualityJob{UnitQC: []domain.UnitQcRecord{{
		UnitID: "p1_i1_u1",
		Checklist: []domain.UnitQcChecklistItem{
			{Code: domain.QcCheckSquare, Passed: true},
			{Code: domain.QcCheckDimensions, Passed: true},
			{Code: domain.QcCheckHardware, Passed: true},
			{Code: domain.QcCheckDoorsDrawers, Passed: true},
			{Code: domain.QcCheckFinish, Passed: true},
			{Code: domain.QcCheckIdentification, Passed: true},
		},
		PassedAt: &passedAt,
	}}}

	rr := doPartExec(srv, http.MethodPost, "/api/projects/p1/units/p1_i1_u1/advance",
		string(domain.RoleProduccion), `{"target_status":"packaged","package_count":3}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
	if store.moduleUnits[0].PackageCount == nil || *store.moduleUnits[0].PackageCount != 3 {
		t.Fatalf("packaging must record package_count=3, got %+v", store.moduleUnits[0].PackageCount)
	}
}

func TestPartExec_QCGateBlocksPackagingWithoutChecklist(t *testing.T) {
	store, srv := partExecFixtures("rev-1")
	store.partInstances[0].Status = domain.PartInstanceStatusReadyForAssembly
	store.partInstances[0].RequiredOperations[0].Status = domain.PartOperationStatusCompleted
	store.moduleUnits[0].Status = domain.ModuleUnitStatusModuleQC

	rr := doPartExec(srv, http.MethodPost, "/api/projects/p1/units/p1_i1_u1/advance",
		string(domain.RoleProduccion), `{"target_status":"packaged","package_count":1}`)
	if rr.Code != http.StatusConflict {
		t.Fatalf("QC gate must block packaging with 409, got %d body=%s", rr.Code, rr.Body.String())
	}
	var body struct {
		Error  string                  `json:"error"`
		QCGate domain.UnitQcGateResult `json:"qc_gate"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &body)
	if body.QCGate.Ready || len(body.QCGate.Failing) == 0 {
		t.Fatalf("QC gate response must carry the failing checks: %+v", body.QCGate)
	}
	if store.moduleUnits[0].Status != domain.ModuleUnitStatusModuleQC {
		t.Fatal("the unit must stay in module_qc when the gate blocks")
	}
}

func TestPartExec_QCGateOpenIssueBlocksPackaging(t *testing.T) {
	store, srv := partExecFixtures("rev-1")
	store.partInstances[0].Status = domain.PartInstanceStatusReadyForAssembly
	store.partInstances[0].RequiredOperations[0].Status = domain.PartOperationStatusCompleted
	store.moduleUnits[0].Status = domain.ModuleUnitStatusModuleQC
	passedAt := time.Date(2026, 8, 21, 11, 0, 0, 0, time.UTC)
	store.qualityJob = &domain.QualityJob{
		UnitQC: []domain.UnitQcRecord{{
			UnitID:    "p1_i1_u1",
			Checklist: []domain.UnitQcChecklistItem{{Code: domain.QcCheckSquare, Passed: true}},
			PassedAt:  &passedAt,
		}},
		Issues: []domain.QualityIssue{{
			ID: "qiss-1", Description: "Cajón trabado", Category: domain.QualityCategoryArmado,
			Status: domain.QualityIssueOpen, ModuleUnitID: "p1_i1_u1",
			ReportedAt: passedAt,
		}},
	}

	rr := doPartExec(srv, http.MethodPost, "/api/projects/p1/units/p1_i1_u1/advance",
		string(domain.RoleProduccion), `{"target_status":"packaged","package_count":1}`)
	if rr.Code != http.StatusConflict {
		t.Fatalf("open issue must block packaging (409), got %d", rr.Code)
	}
}

func TestPartExec_ReworkRecordsCosting(t *testing.T) {
	store, srv := partExecFixtures("rev-1")
	// damage is found AFTER work exists: cut done, piece in progress
	store.partInstances[0].RequiredOperations[0].Status = domain.PartOperationStatusCompleted
	store.partInstances[0].Status = domain.PartInstanceStatusInProgress
	rr := doPartExec(srv, http.MethodPost, "/api/projects/p1/parts/p1_i1_u1_LAT_1/rework",
		string(domain.RoleAdmin), `{"action":"rework","reason":"canto despegado","material_cost":1250.5,"labor_minutes":20}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
	foundCosting := false
	for _, ev := range store.projectEventWrites {
		if strings.Contains(string(ev.Payload), `"material_cost":1250.5`) &&
			strings.Contains(string(ev.Payload), `"labor_minutes":20`) {
			foundCosting = true
		}
	}
	if !foundCosting {
		t.Fatalf("rework events must carry OC-061 costing payload, got %+v", store.projectEventWrites)
	}
}
