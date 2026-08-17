package api

/**
 * F094 — station separation tests: scoped operators advance only their
 * assigned sectors; claim/finish/damage use the claim gate; finishing an
 * activity moves the floor pipeline and writes the audit event.
 */

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func scopedFixtures(sectors []domain.UserSector) (*stubStore, *Server) {
	store := &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "Cocina López", CustomerID: "c1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusAccepted,
			Items: []domain.ProjectItem{
				{ID: "i1", ModuleID: "m-gab", Quantity: 1},
				{ID: "i2", ModuleID: "m-gab", Quantity: 1, FloorStatus: "cut"},
			},
		},
		modulesByID: map[string]*domain.Module{
			"m-gab": {ID: "m-gab", Code: "GAB-01", Name: "Gabinete base"},
		},
		userSectorsList: sectors,
	}
	return store, &Server{Store: store}
}

func TestFloorScan_ScopedOperatorOnlyAdvancesOwnSector(t *testing.T) {
	onlyCutting := []domain.UserSector{{UserID: "u1", Sector: "cutting"}}

	// pending → cut belongs to cutting → allowed.
	store, srv := scopedFixtures(onlyCutting)
	rr := doFloorScan(srv, domain.RoleProduccion, `{"module":"GAB-01","advance":true}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("cut advance should pass, got %d: %s", rr.Code, rr.Body.String())
	}
	if len(store.floorEventWrites) != 1 {
		t.Fatalf("expected audit event, got %+v", store.floorEventWrites)
	}

	// i2 sits at cut → next is edged (edge_banding) → forbidden for cutter.
	_, srv2 := scopedFixtures(onlyCutting)
	rr2 := doFloorScan(srv2, domain.RoleProduccion, `{"module":"GAB-01-L2","advance":true}`)
	if rr2.Code != http.StatusForbidden {
		t.Fatalf("edge advance must 403 for cutting-only operator, got %d: %s", rr2.Code, rr2.Body.String())
	}
	if !strings.Contains(rr2.Body.String(), "Encintado") {
		t.Fatalf("error should name the station, got %s", rr2.Body.String())
	}
}

func TestFloorScan_ProduccionWithoutAssignmentsIsUnrestricted(t *testing.T) {
	_, srv := scopedFixtures(nil) // legacy operator, no user_sectors rows
	rr := doFloorScan(srv, domain.RoleProduccion, `{"module":"GAB-01-L2","advance":true}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("legacy operator should advance freely, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestPatchItemFloorStatus_AlmacenNeverUnrestricted(t *testing.T) {
	// almacen without assignments tries to advance an item: 403 (F094 —
	// warehouse is never unrestricted over the floor pipeline).
	_, srv := scopedFixtures(nil)
	req := withClaims(httptest.NewRequest(http.MethodPatch, "/api/projects/p1/items/i1/floor-status",
		strings.NewReader(`{}`)), "u1", string(domain.RoleAlmacen))
	req.SetPathValue("id", "p1")
	req.SetPathValue("itemId", "i1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleProjectItemFloorStatus(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("almacen without sectors must not advance, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestPatchItemFloorStatus_AlmacenWithShippingSectorCanLoad(t *testing.T) {
	shipping := []domain.UserSector{{UserID: "u1", Sector: "shipping"}}
	_, srv := scopedFixtures(shipping)
	req := withClaims(httptest.NewRequest(http.MethodPatch, "/api/projects/p1/items/i1/floor-status",
		strings.NewReader(`{"status":"loaded"}`)), "u1", string(domain.RoleAlmacen))
	req.SetPathValue("id", "p1")
	req.SetPathValue("itemId", "i1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleProjectItemFloorStatus(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("almacen assigned to shipping should load, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestProductionClaim_GateIsClaimRole(t *testing.T) {
	// gerente_ventas could claim under the old MarkProduced||Export gate;
	// claiming is operator work (F094).
	_, srv := scopedFixtures(nil)
	body := `{"project_id":"p1","item_id":"i1","sector":"cutting"}`
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/production/activity/claim",
		strings.NewReader(body)), "u1", string(domain.RoleGerenteVentas))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleProductionClaim(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("gerente_ventas must not claim, got %d", rr.Code)
	}

	// produccion can.
	_, srv2 := scopedFixtures([]domain.UserSector{{UserID: "u1", Sector: "cutting"}})
	req2 := withClaims(httptest.NewRequest(http.MethodPost, "/api/production/activity/claim",
		strings.NewReader(body)), "u1", string(domain.RoleProduccion))
	req2.Header.Set("Content-Type", "application/json")
	rr2 := httptest.NewRecorder()
	srv2.HandleProductionClaim(rr2, req2)
	if rr2.Code != http.StatusOK {
		t.Fatalf("produccion should claim own sector, got %d: %s", rr2.Code, rr2.Body.String())
	}
}

func TestProductionFinish_AdvancesFloorPipeline(t *testing.T) {
	store, srv := scopedFixtures(nil)
	// i1 pending; a cutting claim by this operator, then finished.
	store.activitiesByID = []domain.ProductionActivity{{
		ID: "a1", ProjectID: "p1", ItemID: "i1", Sector: domain.SectorCutting,
		Type: domain.ActivityClaim, OperatorID: "u1", OperatorName: "Ramón",
	}}
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/production/activity/finish/a1",
		strings.NewReader(`{"pieces_count":4}`)), "u1", string(domain.RoleProduccion))
	req.SetPathValue("activityId", "a1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleProductionFinish(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("finish failed: %d %s", rr.Code, rr.Body.String())
	}
	if len(store.floorStatusWrites) != 1 || store.floorStatusWrites[0].status != "cut" {
		t.Fatalf("finish must advance i1 to cut, got %+v", store.floorStatusWrites)
	}
	if len(store.floorEventWrites) != 1 {
		t.Fatalf("finish must write the audit event, got %+v", store.floorEventWrites)
	}
	ev := store.floorEventWrites[0]
	if ev.From != "pending" || ev.To != "cut" || ev.Source != domain.FloorEventSourceActivity {
		t.Fatalf("unexpected event: %+v", ev)
	}
	if ev.ByName != "Ramón" {
		t.Fatalf("event should carry the operator name, got %q", ev.ByName)
	}
}

func TestProductionFinish_NoPipelineMoveForWarehouse(t *testing.T) {
	// Warehouse staging produces no floor status: finishing the claim must
	// NOT move the pipeline (cut stays pending).
	store, srv := scopedFixtures([]domain.UserSector{{UserID: "u1", Sector: "warehouse"}})
	store.activitiesByID = []domain.ProductionActivity{{
		ID: "a2", ProjectID: "p1", ItemID: "i1", Sector: domain.SectorWarehouse,
		Type: domain.ActivityClaim, OperatorID: "u1", OperatorName: "Depa",
	}}
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/production/activity/finish/a2",
		strings.NewReader(`{}`)), "u1", string(domain.RoleAlmacen))
	req.SetPathValue("activityId", "a2")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleProductionFinish(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("finish failed: %d %s", rr.Code, rr.Body.String())
	}
	if len(store.floorStatusWrites) != 0 {
		t.Fatalf("warehouse finish must NOT move the pipeline, got %+v", store.floorStatusWrites)
	}
}

func TestDamageResolve_OnlyProductionStaff(t *testing.T) {
	_, srv := scopedFixtures(nil)
	req := withClaims(httptest.NewRequest(http.MethodPatch, "/api/production/damage/d1/resolve",
		nil), "u1", string(domain.RoleProduccion))
	req.SetPathValue("id", "d1")
	rr := httptest.NewRecorder()
	srv.HandleProductionDamageResolve(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("operator must not resolve damage, got %d", rr.Code)
	}

	req2 := withClaims(httptest.NewRequest(http.MethodPatch, "/api/production/damage/d1/resolve",
		nil), "u2", string(domain.RoleGerenteProduccion))
	req2.SetPathValue("id", "d1")
	rr2 := httptest.NewRecorder()
	srv.HandleProductionDamageResolve(rr2, req2)
	if rr2.Code != http.StatusOK {
		t.Fatalf("gerente_produccion should resolve, got %d", rr2.Code)
	}
}

func TestMySectors_ReturnsOwnAssignments(t *testing.T) {
	_, srv := scopedFixtures([]domain.UserSector{
		{UserID: "u1", Sector: "cutting"},
		{UserID: "u1", Sector: "assembly"},
	})
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/me/sectors", nil), "u1", string(domain.RoleProduccion))
	rr := httptest.NewRecorder()
	srv.HandleMySectors(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	var sectors []domain.UserSector
	if err := json.Unmarshal(rr.Body.Bytes(), &sectors); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	if len(sectors) != 2 {
		t.Fatalf("expected 2 sectors, got %+v", sectors)
	}
}

func TestRoleCanAdvanceStationParity(t *testing.T) {
	// Mirror of the TS rbac test — keeps both sides honest.
	if !domain.RoleCanAdvanceStation(domain.RoleAdmin, "loaded", nil) {
		t.Fatal("admin should advance anything")
	}
	if domain.RoleCanAdvanceStation(domain.RoleProduccion, "pending", []string{"cutting"}) {
		t.Fatal("nobody advances into pending")
	}
	if !domain.RoleCanAdvanceStation(domain.RoleProduccion, "cut", []string{"cutting"}) {
		t.Fatal("cutter should advance to cut")
	}
	if domain.RoleCanAdvanceStation(domain.RoleProduccion, "edged", []string{"cutting"}) {
		t.Fatal("cutter should not advance to edged")
	}
	if domain.RoleCanAdvanceStation(domain.RoleAlmacen, "cut", nil) {
		t.Fatal("almacen is never unrestricted")
	}
	if domain.RoleCanAdvanceStation(domain.RoleVendedor, "cut", []string{"cutting"}) {
		t.Fatal("vendedor never advances floor status")
	}
}
