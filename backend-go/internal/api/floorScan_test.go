package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func floorScanTestFixtures() (*stubStore, *Server) {
	store := &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "Cocina López", CustomerID: "c1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusAccepted,
			Items: []domain.ProjectItem{
				{ID: "i1", ModuleID: "m-gab", Quantity: 1},
				{ID: "i2", ModuleID: "m-gab", Quantity: 1, FloorStatus: "cut"},
				{ID: "i3", ModuleID: "m-alt", Quantity: 2},
			},
		},
		modulesByID: map[string]*domain.Module{
			"m-gab": {ID: "m-gab", Code: "GAB-01", Name: "Gabinete base"},
			"m-alt": {ID: "m-alt", Code: "ALT-01", Name: "Alacena"},
		},
	}
	return store, &Server{Store: store}
}

func doFloorScan(store *Server, role domain.UserRole, body string) *httptest.ResponseRecorder {
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects/p1/floor-scan", strings.NewReader(body)), "u1", string(role))
	req.SetPathValue("id", "p1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	store.HandleProjectFloorScan(rr, req)
	return rr
}

func TestFloorScan_ResolvesModuleAndAdvances(t *testing.T) {
	store, srv := floorScanTestFixtures()
	rr := doFloorScan(srv, domain.RoleProduccion, `{"module":"GAB-01","advance":true}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
	var resp floorScanResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	if resp.ItemID != "i1" {
		t.Fatalf("expected first GAB-01 line, got %s", resp.ItemID)
	}
	if resp.FactoryCode != "GAB-01" || resp.ModuleName != "Gabinete base" {
		t.Fatalf("unexpected resolution: %+v", resp)
	}
	if resp.StatusBefore != "pending" || resp.StatusAfter != "cut" || resp.NextStatus != "edged" {
		t.Fatalf("unexpected statuses: %+v", resp)
	}
	if len(store.floorStatusWrites) != 1 || store.floorStatusWrites[0].status != "cut" {
		t.Fatalf("expected one atomic write to cut, got %+v", store.floorStatusWrites)
	}
}

func TestFloorScan_FactoryCodeSuffixSelectsSecondLine(t *testing.T) {
	_, srv := floorScanTestFixtures()
	rr := doFloorScan(srv, domain.RoleAdmin, `{"module":"GAB-01","factory_code":"GAB-01-L2","advance":true}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
	var resp floorScanResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	if resp.ItemID != "i2" {
		t.Fatalf("expected second line i2, got %s", resp.ItemID)
	}
	// i2 starts at cut → edged
	if resp.StatusAfter != "edged" {
		t.Fatalf("expected edged, got %s", resp.StatusAfter)
	}
}

func TestFloorScan_LookupWithoutAdvanceDoesNotWrite(t *testing.T) {
	store, srv := floorScanTestFixtures()
	rr := doFloorScan(srv, domain.RoleProduccion, `{"module":"ALT-01"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
	var resp floorScanResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	if resp.StatusBefore != resp.StatusAfter || resp.StatusAfter != "pending" {
		t.Fatalf("lookup must not change status: %+v", resp)
	}
	if len(store.floorStatusWrites) != 0 {
		t.Fatalf("no writes expected on lookup, got %+v", store.floorStatusWrites)
	}
}

func TestFloorScan_InstalledStaysComplete(t *testing.T) {
	store, srv := floorScanTestFixtures()
	store.projectReturnedByID.Items[0].FloorStatus = "installed"
	rr := doFloorScan(srv, domain.RoleProduccion, `{"module":"GAB-01","advance":true}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
	var resp floorScanResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	if resp.StatusAfter != "installed" || resp.NextStatus != "" {
		t.Fatalf("installed must stay complete: %+v", resp)
	}
	if len(store.floorStatusWrites) != 0 {
		t.Fatalf("no write expected when complete")
	}
}

func TestFloorScan_VendedorForbidden(t *testing.T) {
	_, srv := floorScanTestFixtures()
	rr := doFloorScan(srv, domain.RoleVendedor, `{"module":"GAB-01","advance":true}`)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("vendedor must be 403, got %d", rr.Code)
	}
}

func TestFloorScan_UnknownModule404(t *testing.T) {
	_, srv := floorScanTestFixtures()
	rr := doFloorScan(srv, domain.RoleProduccion, `{"module":"NOPE-99"}`)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("unknown module must be 404, got %d", rr.Code)
	}
}

func TestItemFloorStatusHelpers(t *testing.T) {
	if domain.NormalizeItemFloorStatus("bogus") != "pending" {
		t.Fatal("unknown normalizes to pending")
	}
	if domain.NextItemFloorStatus("pending") != "cut" {
		t.Fatal("pending → cut")
	}
	if domain.NextItemFloorStatus("installed") != "" {
		t.Fatal("installed has no next")
	}
	if domain.NextItemFloorStatus("garbage") != "cut" {
		t.Fatal("garbage normalizes then advances")
	}
}

func TestPatchItemFloorStatus_ExplicitStatus(t *testing.T) {
	store, srv := floorScanTestFixtures()
	req := withClaims(httptest.NewRequest(http.MethodPatch, "/api/projects/p1/items/i1/floor-status", strings.NewReader(`{"status":"edged"}`)), "u1", string(domain.RoleProduccion))
	req.SetPathValue("id", "p1")
	req.SetPathValue("itemId", "i1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleProjectItemFloorStatus(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if len(store.floorStatusWrites) != 1 || store.floorStatusWrites[0].status != "edged" {
		t.Fatalf("expected write to edged, got %+v", store.floorStatusWrites)
	}
}

func TestPatchItemFloorStatus_EmptyStatusAdvances(t *testing.T) {
	store, srv := floorScanTestFixtures()
	req := withClaims(httptest.NewRequest(http.MethodPatch, "/api/projects/p1/items/i1/floor-status", strings.NewReader(`{}`)), "u1", string(domain.RoleProduccion))
	req.SetPathValue("id", "p1")
	req.SetPathValue("itemId", "i1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleProjectItemFloorStatus(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	// i1 was pending, so it advances to cut
	if len(store.floorStatusWrites) != 1 || store.floorStatusWrites[0].status != "cut" {
		t.Fatalf("expected advance to cut, got %+v", store.floorStatusWrites)
	}
}

func TestPatchItemFloorStatus_ForbiddenRole(t *testing.T) {
	_, srv := floorScanTestFixtures()
	req := withClaims(httptest.NewRequest(http.MethodPatch, "/api/projects/p1/items/i1/floor-status", strings.NewReader(`{"status":"cut"}`)), "u1", string(domain.RoleVendedor))
	req.SetPathValue("id", "p1")
	req.SetPathValue("itemId", "i1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleProjectItemFloorStatus(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rr.Code)
	}
}

