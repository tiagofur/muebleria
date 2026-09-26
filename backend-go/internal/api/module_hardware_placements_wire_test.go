package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

/**
 * #858 — wire contract of the module catalog API: the HTTP surface must carry
 * ComponentInstanceOverrides.hardwarePlacements in BOTH directions. The
 * persistence round-trip is pinned by the storage regressions; this test
 * catches DTO-level regressions (a renamed/omitted field would silently
 * re-introduce the loss one layer up). The full PUT→GET→release/routing
 * journey over the real server is proven by the browser organization gate.
 */

func TestHandleModuleByIDWireCarriesHardwarePlacements(t *testing.T) {
	wireBody := `{
		"code": "MOD-858",
		"name": "Módulo 858",
		"width_mm": 600, "height_mm": 720, "depth_mm": 590,
		"components": [
			{
				"componentId": "5a5a8585-0000-4000-8000-00000000c858",
				"quantity": 1,
				"overrides": {
					"hardwarePlacements": [
						{
							"hardwareId": "hw-858-hinge",
							"anchorFace": "front",
							"relativePosition": {"xMm": 300, "yMm": 100}
						}
					]
				}
			}
		]
	}`

	store := &stubStore{}
	srv := &Server{Store: store}

	put := withClaims(httptest.NewRequest("PUT", "/api/catalog/modules/mod858", strings.NewReader(wireBody)), "eng", string(domain.RoleIngeniero))
	put.SetPathValue("id", "mod858")
	putRR := httptest.NewRecorder()
	srv.HandleModuleByID(putRR, put)
	if putRR.Code != http.StatusOK {
		t.Fatalf("PUT status = %d (body=%s)", putRR.Code, putRR.Body.String())
	}
	if !store.updateModuleCalled || store.updateModuleReceived == nil {
		t.Fatal("UpdateModule was not invoked with the decoded payload")
	}
	instances := store.updateModuleReceived.Components
	if len(instances) != 1 || instances[0].Overrides == nil || len(instances[0].Overrides.HardwarePlacements) != 1 {
		t.Fatalf("PUT dropped the hardwarePlacements-only override bag: %+v", instances)
	}
	placement := instances[0].Overrides.HardwarePlacements[0]
	if placement.HardwareID != "hw-858-hinge" || placement.AnchorFace != "front" ||
		placement.RelativePosition.XMm != 300 || placement.RelativePosition.YMm != 100 {
		t.Fatalf("placement drifted on decode: %+v", placement)
	}

	// GET must echo the stored module verbatim — the read side of the wire.
	stored := *store.updateModuleReceived
	store.moduleReturnedByID = &stored
	get := withClaims(httptest.NewRequest("GET", "/api/catalog/modules/mod858", nil), "eng", string(domain.RoleIngeniero))
	get.SetPathValue("id", "mod858")
	getRR := httptest.NewRecorder()
	srv.HandleModuleByID(getRR, get)
	if getRR.Code != http.StatusOK {
		t.Fatalf("GET status = %d (body=%s)", getRR.Code, getRR.Body.String())
	}
	if !strings.Contains(getRR.Body.String(), `"hardwarePlacements"`) ||
		!strings.Contains(getRR.Body.String(), `"hw-858-hinge"`) {
		t.Fatalf("GET response lost the hardware placements: %s", getRR.Body.String())
	}
}
