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
 * Job costing endpoints (OC-080..OC-084, issue #304): baseline frozen from
 * quote snapshot + release, time entries with frozen rate, other actuals,
 * server-computed estimate vs actual summary and the cost-visibility gate.
 */

func costingFixtures() (*stubStore, *Server) {
	snapshot := &domain.QuotePriceSnapshot{
		CapturedAt: time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC),
		Breakdown: domain.QuoteBreakdown{
			MaterialsCost: 100, EdgeTotal: 20, HardwareTotal: 30, DirectCost: 150,
			LaborModular: 50, LaborFixedCost: 10, MarginFactor: 1.3, SalePrice: 400,
		},
	}
	release := domain.ResolveLegacyProductionRelease(&domain.LegacyProductionRelease{
		ID: "rel-1", ProjectID: "p1", ProjectVersion: 1, DesignRevisionID: "dr-1",
		BOMFingerprint: "fp-abc123", ReleasedBy: "ing-1", ReleasedAt: time.Date(2026, 8, 20, 11, 0, 0, 0, time.UTC),
	})
	poCost := 10.0
	catalogCost := 8.0
	store := &stubStore{
		costingPriceSnapshot: snapshot,
		productionRelease:    release,
		qualityJob: &domain.QualityJob{
			ID: "qj-1", ProjectID: "p1",
			ReworkActions: []domain.ReworkAction{
				{ID: "r1", IssueID: "i1", Action: domain.ReworkActionScrap, MaterialCost: 12, LaborMinutes: 30, At: time.Date(2026, 8, 21, 9, 0, 0, 0, time.UTC)},
			},
		},
		costingConsumption: []domain.MaterialConsumptionInput{
			{MaterialID: "mat-po", Quantity: 5, POUnitCost: &poCost},
			{MaterialID: "mat-cat", Quantity: 2, CatalogUnitCost: &catalogCost},
		},
	}
	return store, &Server{Store: store}
}

func doCosting(srv *Server, method, path, role, body string) *httptest.ResponseRecorder {
	req := withClaims(httptest.NewRequest(method, path, strings.NewReader(body)), "u1", role)
	req.SetPathValue("id", "p1")
	for _, pair := range [][2]string{{"entryId", "tme-1"}, {"costId", "oth-1"}} {
		if req.PathValue(pair[0]) == "" {
			req.SetPathValue(pair[0], pair[1])
		}
	}
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	switch {
	case strings.HasSuffix(path, "/costing/baseline"):
		srv.HandleCostingBaseline(rr, req)
	case strings.HasSuffix(path, "/costing/labor-rate"):
		srv.HandleCostingLaborRate(rr, req)
	case strings.HasSuffix(path, "/costing/time") && method == http.MethodPost:
		srv.HandleCostingTime(rr, req)
	case strings.Contains(path, "/costing/time/") && strings.HasSuffix(path, "/void"):
		srv.HandleCostingTimeVoid(rr, req)
	case strings.HasSuffix(path, "/costing/other") && method == http.MethodPost:
		srv.HandleCostingOther(rr, req)
	case strings.Contains(path, "/costing/other/") && strings.HasSuffix(path, "/void"):
		srv.HandleCostingOtherVoid(rr, req)
	default:
		srv.HandleProjectCosting(rr, req)
	}
	return rr
}

func decodeCostingView(t *testing.T, rr *httptest.ResponseRecorder) costingViewResponse {
	t.Helper()
	var view costingViewResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &view); err != nil {
		t.Fatalf("decode costing view: %v body %s", err, rr.Body.String())
	}
	return view
}

func TestCosting_BaselineFreezesSnapshotAndRelease(t *testing.T) {
	store, srv := costingFixtures()
	rr := doCosting(srv, http.MethodPost, "/api/projects/p1/costing/baseline", string(domain.RoleGerenteProduccion), `{}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("baseline = %d body %s", rr.Code, rr.Body.String())
	}
	view := decodeCostingView(t, rr)
	if view.Costing == nil || view.Costing.Baseline == nil {
		t.Fatal("baseline must be persisted on the costing payload")
	}
	b := view.Costing.Baseline
	if b.Revenue != 400 || b.EstimatedDirectCost != 210 || b.ExpectedGrossMargin != 190 {
		t.Errorf("baseline = %+v", b)
	}
	if b.Source.ReleaseID != "rel-1" || b.Source.BOMFingerprint != "fp-abc123" {
		t.Errorf("baseline source = %+v", b.Source)
	}
	if len(store.costingEvents) != 1 || store.costingEvents[0].Type != "cost_baseline_captured" {
		t.Fatalf("baseline must audit cost_baseline_captured: %+v", store.costingEvents)
	}

	// Same release → recapture is a conflict.
	rr = doCosting(srv, http.MethodPost, "/api/projects/p1/costing/baseline", string(domain.RoleGerenteProduccion), `{}`)
	if rr.Code != http.StatusConflict {
		t.Fatalf("recapture for the same release must 409, got %d", rr.Code)
	}
}

func TestCosting_BaselineRequiresSnapshotAndRelease(t *testing.T) {
	store, srv := costingFixtures()
	store.costingPriceSnapshot = nil
	rr := doCosting(srv, http.MethodPost, "/api/projects/p1/costing/baseline", string(domain.RoleAdmin), `{}`)
	if rr.Code != http.StatusBadRequest || !strings.Contains(rr.Body.String(), "snapshot de cotización") {
		t.Fatalf("without snapshot must 400 explaining the blocker, got %d %s", rr.Code, rr.Body.String())
	}

	store, srv = costingFixtures()
	store.productionRelease = nil
	rr = doCosting(srv, http.MethodPost, "/api/projects/p1/costing/baseline", string(domain.RoleAdmin), `{}`)
	if rr.Code != http.StatusBadRequest || !strings.Contains(rr.Body.String(), "liberar la revisión") {
		t.Fatalf("without release must 400 explaining the blocker, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestCosting_TimeEntriesOtherCostsAndSummary(t *testing.T) {
	_, srv := costingFixtures()
	if rr := doCosting(srv, http.MethodPost, "/api/projects/p1/costing/baseline", string(domain.RoleAdmin), `{}`); rr.Code != http.StatusOK {
		t.Fatalf("baseline = %d body %s", rr.Code, rr.Body.String())
	}
	if rr := doCosting(srv, http.MethodPost, "/api/projects/p1/costing/labor-rate", string(domain.RoleAdmin), `{"rate_per_hour":30}`); rr.Code != http.StatusOK {
		t.Fatalf("labor rate = %d body %s", rr.Code, rr.Body.String())
	}
	// Producción logs floor time; almacen logs freight.
	if rr := doCosting(srv, http.MethodPost, "/api/projects/p1/costing/time", string(domain.RoleProduccion),
		`{"category":"cut","minutes":60}`); rr.Code != http.StatusOK {
		t.Fatalf("time = %d body %s", rr.Code, rr.Body.String())
	}
	if rr := doCosting(srv, http.MethodPost, "/api/projects/p1/costing/time", string(domain.RoleProduccion),
		`{"category":"assembly","minutes":90}`); rr.Code != http.StatusOK {
		t.Fatalf("time 2 = %d body %s", rr.Code, rr.Body.String())
	}
	if rr := doCosting(srv, http.MethodPost, "/api/projects/p1/costing/other", string(domain.RoleAlmacen),
		`{"kind":"freight","amount":80}`); rr.Code != http.StatusOK {
		t.Fatalf("other = %d body %s", rr.Code, rr.Body.String())
	}

	rr := doCosting(srv, http.MethodGet, "/api/projects/p1/costing", string(domain.RoleAdmin), "")
	if rr.Code != http.StatusOK {
		t.Fatalf("get costing = %d body %s", rr.Code, rr.Body.String())
	}
	view := decodeCostingView(t, rr)

	// Mirror of the domain numbers: material 66 consumption + 12 rework,
	// labor 150 min + 30 rework @ 30/h = 90, other 80 → direct 248.
	if view.Summary.ActualMaterialCost != 78 {
		t.Errorf("actual material = %v, want 78", view.Summary.ActualMaterialCost)
	}
	if view.Summary.ActualLaborCost == nil || *view.Summary.ActualLaborCost != 90 {
		t.Errorf("actual labor = %v, want 90", view.Summary.ActualLaborCost)
	}
	if view.Summary.ActualDirectCost == nil || *view.Summary.ActualDirectCost != 248 {
		t.Errorf("actual direct = %v, want 248", view.Summary.ActualDirectCost)
	}
	if view.Summary.Variance == nil || *view.Summary.Variance != 38 {
		t.Errorf("variance = %v, want 38", view.Summary.Variance)
	}
	if view.Summary.ActualGrossMargin == nil || *view.Summary.ActualGrossMargin != 152 {
		t.Errorf("actual margin = %v, want 152", view.Summary.ActualGrossMargin)
	}
	if len(view.Material.Lines) != 2 || view.Material.Lines[0].Truth != domain.CostTruthActual || view.Material.Lines[1].Truth != domain.CostTruthProxy {
		t.Errorf("material lines = %+v", view.Material.Lines)
	}
}

func TestCosting_VoidEntryRequiresSupervisor(t *testing.T) {
	store, srv := costingFixtures()
	doCosting(srv, http.MethodPost, "/api/projects/p1/costing/baseline", string(domain.RoleAdmin), `{}`)
	doCosting(srv, http.MethodPost, "/api/projects/p1/costing/labor-rate", string(domain.RoleAdmin), `{"rate_per_hour":30}`)
	rr := doCosting(srv, http.MethodPost, "/api/projects/p1/costing/time", string(domain.RoleProduccion), `{"category":"cut","minutes":60}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("time = %d body %s", rr.Code, rr.Body.String())
	}
	entryID := store.jobCosting.TimeEntries[0].ID

	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects/p1/costing/time/"+entryID+"/void", strings.NewReader(`{"reason":"dup"}`)), "u2", string(domain.RoleProduccion))
	req.SetPathValue("id", "p1")
	req.SetPathValue("entryId", entryID)
	rr = httptest.NewRecorder()
	srv.HandleCostingTimeVoid(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("floor cannot void entries, got %d", rr.Code)
	}

	req = withClaims(httptest.NewRequest(http.MethodPost, "/api/projects/p1/costing/time/"+entryID+"/void", strings.NewReader(`{"reason":"dup"}`)), "u1", string(domain.RoleAdmin))
	req.SetPathValue("id", "p1")
	req.SetPathValue("entryId", entryID)
	rr = httptest.NewRecorder()
	srv.HandleCostingTimeVoid(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("supervisor void = %d body %s", rr.Code, rr.Body.String())
	}
	if store.jobCosting.TimeEntries[0].RemovedAt == nil {
		t.Error("void must be a soft delete with audit trail")
	}
	last := store.costingEvents[len(store.costingEvents)-1]
	if last.Type != "cost_entry_voided" {
		t.Errorf("void must audit cost_entry_voided, got %s", last.Type)
	}

	// Double void → conflict.
	req = withClaims(httptest.NewRequest(http.MethodPost, "/api/projects/p1/costing/time/"+entryID+"/void", strings.NewReader(`{}`)), "u1", string(domain.RoleAdmin))
	req.SetPathValue("id", "p1")
	req.SetPathValue("entryId", entryID)
	rr = httptest.NewRecorder()
	srv.HandleCostingTimeVoid(rr, req)
	if rr.Code != http.StatusConflict {
		t.Fatalf("double void must 409, got %d", rr.Code)
	}
}

func TestCosting_CostVisibilityGate(t *testing.T) {
	store, srv := costingFixtures()
	doCosting(srv, http.MethodPost, "/api/projects/p1/costing/baseline", string(domain.RoleAdmin), `{}`)

	// Vendedor without the workshop flag cannot even read costs (F039/F044).
	rr := doCosting(srv, http.MethodGet, "/api/projects/p1/costing", string(domain.RoleVendedor), "")
	if rr.Code != http.StatusForbidden {
		t.Fatalf("vendedor without flag must 403, got %d", rr.Code)
	}

	// Same vendedor with the flag enabled reads the costing view.
	if store.workshopSettings == nil {
		store.workshopSettings = &domain.WorkshopSettings{}
	}
	flagOn := *store.workshopSettings
	flagOn.VendedorCanViewCosts = true
	store.workshopSettings = &flagOn
	rr = doCosting(srv, http.MethodGet, "/api/projects/p1/costing", string(domain.RoleVendedor), "")
	if rr.Code != http.StatusOK {
		t.Fatalf("vendedor with flag must read costing, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestCosting_TimeValidation(t *testing.T) {
	_, srv := costingFixtures()
	doCosting(srv, http.MethodPost, "/api/projects/p1/costing/baseline", string(domain.RoleAdmin), `{}`)
	if rr := doCosting(srv, http.MethodPost, "/api/projects/p1/costing/time", string(domain.RoleAdmin),
		`{"category":"carpinteria","minutes":60}`); rr.Code != http.StatusBadRequest {
		t.Fatalf("invalid category must 400, got %d", rr.Code)
	}
	if rr := doCosting(srv, http.MethodPost, "/api/projects/p1/costing/time", string(domain.RoleAdmin),
		`{"category":"cut","minutes":0}`); rr.Code != http.StatusBadRequest {
		t.Fatalf("zero minutes must 400, got %d", rr.Code)
	}
}

func TestCosting_UnknownProject(t *testing.T) {
	store, srv := costingFixtures()
	store.costingProjectMissing = true
	rr := doCosting(srv, http.MethodGet, "/api/projects/p1/costing", string(domain.RoleAdmin), "")
	if rr.Code != http.StatusNotFound {
		t.Fatalf("unknown project must 404, got %d", rr.Code)
	}
}
