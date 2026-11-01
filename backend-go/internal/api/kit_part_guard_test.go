package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1436 (owner decision 10-31): kit design parts are never purchasable on
// their own — they cannot join option groups or fixed module hardware lines,
// and a hardware PUT that omits kit_hardware_id must not silently unlink.

func kitLink(id string) *string {
	return &id
}

func kitPartGuardFixture() []domain.Hardware {
	return []domain.Hardware{
		{ID: "kit-494", Code: "49402645", Name: "Set corredera", Unit: "set", Active: true},
		{ID: "parte-fij-i", Code: "49402645-FIJ-I", Name: "Guía fija izquierda", Unit: "piece", Active: true, KitHardwareID: kitLink("kit-494")},
		{ID: "bisagra-1", Code: "BIS-CL110", Name: "Bisagra clip", Unit: "piece", Active: true},
	}
}

func TestHandleOptionGroupsPostRejectsKitPartMember(t *testing.T) {
	srv := &Server{Store: &stubStore{listHardwares: kitPartGuardFixture()}}

	body := strings.NewReader(`{
		"code":"BISAGRAS","name":"Bisagras","kind":"hardware","required":true,
		"option_ids":["bisagra-1","parte-fij-i"]
	}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/option-groups", body), "admin", string(domain.RoleAdmin))
	rr := httptest.NewRecorder()
	srv.HandleOptionGroups(rr, req)

	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "OPTION_GROUP_KIT_PART") {
		t.Fatalf("body missing typed code: %s", rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "49402645-FIJ-I") {
		t.Fatalf("body must name the offending part code: %s", rr.Body.String())
	}
}

func TestHandleOptionGroupsPostAcceptsNonPartHardware(t *testing.T) {
	srv := &Server{Store: &stubStore{listHardwares: kitPartGuardFixture(), createOptionGroupArmed: true}}

	body := strings.NewReader(`{
		"code":"BISAGRAS","name":"Bisagras","kind":"hardware","required":true,
		"option_ids":["bisagra-1"]
	}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/option-groups", body), "admin", string(domain.RoleAdmin))
	rr := httptest.NewRecorder()
	srv.HandleOptionGroups(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestHandleOptionGroupByIDPutRejectsKitPartMember(t *testing.T) {
	srv := &Server{Store: &stubStore{listHardwares: kitPartGuardFixture(), updateOptionGroupArmed: true}}

	body := strings.NewReader(`{
		"code":"BISAGRAS","name":"Bisagras","kind":"hardware","required":true,
		"option_ids":["parte-fij-i"]
	}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/option-groups/og1", body), "admin", string(domain.RoleAdmin))
	req.Header.Set("If-Match", `"v1"`)
	req.SetPathValue("id", "og1")
	rr := httptest.NewRecorder()
	srv.HandleOptionGroupByID(rr, req)

	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "OPTION_GROUP_KIT_PART") {
		t.Fatalf("body missing typed code: %s", rr.Body.String())
	}
}

// A board group ignores hardware kit links entirely — the guard is scoped to
// kind=hardware.
func TestHandleOptionGroupsPostIgnoresGuardForBoardKind(t *testing.T) {
	srv := &Server{Store: &stubStore{listHardwares: kitPartGuardFixture(), createOptionGroupArmed: true}}

	body := strings.NewReader(`{
		"code":"TBL","name":"Tableros","kind":"board","required":false,
		"option_ids":["parte-fij-i"]
	}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/option-groups", body), "admin", string(domain.RoleAdmin))
	rr := httptest.NewRecorder()
	srv.HandleOptionGroups(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
}

// The live-session data loss: a partial GET→PUT client that omits
// kit_hardware_id would clear the link. Fail closed with a typed 422.
func TestHandleHardwareByIDPutRejectsAbsentKitLink(t *testing.T) {
	store := &stubStore{hardwareReturnedByID: &domain.Hardware{
		ID: "h1", Code: "49402645-FIJ-I", Name: "Guía fija", Unit: "piece", Active: true,
		KitHardwareID: kitLink("kit-494"),
	}}
	srv := &Server{Store: store}

	body := strings.NewReader(`{
		"code":"49402645-FIJ-I","name":"Guía fija","unit":"piece","cost_per_unit":0,"active":true
	}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/hardware/h1", body), "admin", string(domain.RoleAdmin))
	req.Header.Set("If-Match", `"v1"`)
	req.SetPathValue("id", "h1")
	rr := httptest.NewRecorder()
	srv.HandleHardwareByID(rr, req)

	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "HARDWARE_KIT_LINK_REQUIRED") {
		t.Fatalf("body missing typed code: %s", rr.Body.String())
	}
	if store.updateHardwareCalled {
		t.Error("the guard must reject before any write")
	}
}

// An explicit null IS the deliberate unlink — it must keep flowing.
func TestHandleHardwareByIDPutAllowsExplicitNullKitLink(t *testing.T) {
	store := &stubStore{hardwareReturnedByID: &domain.Hardware{
		ID: "h1", Code: "49402645-FIJ-I", Name: "Guía fija", Unit: "piece", Active: true,
		KitHardwareID: kitLink("kit-494"),
	}}
	srv := &Server{Store: store}

	body := strings.NewReader(`{
		"code":"49402645-FIJ-I","name":"Guía fija","unit":"piece","cost_per_unit":0,"active":true,
		"kit_hardware_id":null
	}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/hardware/h1", body), "admin", string(domain.RoleAdmin))
	req.Header.Set("If-Match", `"v1"`)
	req.SetPathValue("id", "h1")
	rr := httptest.NewRecorder()
	srv.HandleHardwareByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if !store.updateHardwareCalled {
		t.Fatal("the explicit unlink must reach the store")
	}
	if store.updateHardwareReceived == nil || store.updateHardwareReceived.KitHardwareID != nil {
		t.Fatal("the explicit null must flow through as an unlink")
	}
}

func TestHandleModulesPostRejectsKitPartHardwareLine(t *testing.T) {
	store := &stubStore{listHardwares: kitPartGuardFixture(), createModuleArmed: true}
	srv := newModuleMutationServer(store)

	body := strings.NewReader(`{
		"code":"MOD-X","name":"Módulo X",
		"hardware_lines":[{"quantity":2,"hardware_id":"parte-fij-i","option_role":""}]
	}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/modules", body), "eng", string(domain.RoleIngeniero))
	rr := httptest.NewRecorder()
	srv.HandleModules(rr, req)

	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "MODULE_HARDWARE_KIT_PART") {
		t.Fatalf("body missing typed code: %s", rr.Body.String())
	}
	if store.createModuleReceived != nil {
		t.Error("the guard must reject before any write")
	}
}

func TestHandleModuleByIDPutRejectsKitPartHardwareLine(t *testing.T) {
	store := &stubStore{
		listHardwares:       kitPartGuardFixture(),
		moduleReturnedByID:  &domain.Module{ID: "mod1", Code: "MOD-X", Name: "Módulo X"},
	}
	srv := newModuleMutationServer(store)

	body := strings.NewReader(`{
		"code":"MOD-X","name":"Módulo X",
		"hardware_lines":[{"quantity":1,"hardware_id":"parte-fij-i"}]
	}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/modules/mod1", body), "eng", string(domain.RoleIngeniero))
	req.SetPathValue("id", "mod1")
	req.Header.Set("If-Match", `"v1"`)
	rr := httptest.NewRecorder()
	srv.HandleModuleByID(rr, req)

	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "MODULE_HARDWARE_KIT_PART") {
		t.Fatalf("body missing typed code: %s", rr.Body.String())
	}
	if store.updateModuleCalled {
		t.Error("the guard must reject before any write")
	}
}
