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

// #1556: the opaque-kit rule enforced server-side on agregado recipes. A
// part of a kit the agregado MOUNTS is a normal member (the kit wizard
// writes them); a part of a foreign kit, a part bought in a fixed hardware
// line, or a "kit" that is itself a part is rejected with a typed 422 that
// names the codes.
func agregadoKitPartFixture() []domain.Hardware {
	return []domain.Hardware{
		{ID: "kit-494", Code: "49402645", Name: "Set corredera", Unit: "set", Active: true},
		{ID: "parte-fij-i", Code: "49402645-FIJ-I", Name: "Guía fija izquierda", Unit: "piece", Active: true, KitHardwareID: kitLink("kit-494")},
		{ID: "kit-otro", Code: "KIT-OTRO", Name: "Otro set", Unit: "set", Active: true},
		{ID: "parte-otra", Code: "KIT-OTRO-FIJ", Name: "Parte de otro set", Unit: "piece", Active: true, KitHardwareID: kitLink("kit-otro")},
	}
}

func agregadoKitPartRequest(body string) (*Server, *httptest.ResponseRecorder, *http.Request) {
	srv := &Server{Store: &stubStore{listHardwares: agregadoKitPartFixture(), getOrgByID: customLibraryOrg()}}
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/agregados", strings.NewReader(body)), "admin", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	return srv, httptest.NewRecorder(), req
}

func agregadoKitPartBody(kit string, memberHardware string, lineHardware string) string {
	lines := "[]"
	if lineHardware != "" {
		lines = `[{"id":"l1","quantity":1,"option_role":"","hardware_id":"` + lineHardware + `"}]`
	}
	return `{
		"id":"agr-1","code":"CAJ-1","name":"Cajón","width_mm":400,"height_mm":150,"depth_mm":500,
		"commercial_kit_hardware_id":"` + kit + `",
		"hardware_lines":` + lines + `,
		"rigid_members":[{"memberId":"fixed_rail_left","role":"fixed_rail",
			"source":{"kind":"fixed","fixed":{"hardwareId":"` + memberHardware + `"}},
			"placement":{"x":{"ref":"min","offsetMm":0},"y":{"ref":"min","offsetMm":0},"z":{"ref":"min","offsetMm":0}},
			"bomRole":"included_in_kit"}]
	}`
}

func TestHandleAgregadosPostRejectsPartOfForeignKit_1556(t *testing.T) {
	srv, rr, req := agregadoKitPartRequest(agregadoKitPartBody("kit-494", "parte-otra", ""))
	srv.HandleAgregados(rr, req)

	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "AGREGADO_KIT_PART") || !strings.Contains(rr.Body.String(), "KIT-OTRO-FIJ") {
		t.Fatalf("body must carry the typed code and name the part: %s", rr.Body.String())
	}
}

func TestHandleAgregadosPostRejectsPartBoughtInHardwareLine_1556(t *testing.T) {
	// Even a part of the MOUNTED kit cannot be bought on its own line.
	srv, rr, req := agregadoKitPartRequest(agregadoKitPartBody("kit-494", "parte-fij-i", "parte-fij-i"))
	srv.HandleAgregados(rr, req)

	if rr.Code != http.StatusUnprocessableEntity || !strings.Contains(rr.Body.String(), "49402645-FIJ-I") {
		t.Fatalf("status = %d, want 422 naming the part (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestHandleAgregadosPostRejectsPartAsCommercialKit_1556(t *testing.T) {
	srv, rr, req := agregadoKitPartRequest(agregadoKitPartBody("parte-otra", "parte-otra", ""))
	srv.HandleAgregados(rr, req)

	if rr.Code != http.StatusUnprocessableEntity || !strings.Contains(rr.Body.String(), "AGREGADO_KIT_PART") {
		t.Fatalf("a part used as the commercial kit must be rejected: %d %s", rr.Code, rr.Body.String())
	}
}

func TestHandleAgregadosPostAcceptsPartsOfMountedKit_1556(t *testing.T) {
	// The kit wizard's own recipe shape: members are parts of the kit the
	// agregado mounts. The guard must let it through (the store stub then
	// panics on an unexpected CreateAgregado — reaching it proves the pass).
	srv, rr, req := agregadoKitPartRequest(agregadoKitPartBody("kit-494", "parte-fij-i", ""))
	defer func() {
		if recovered := recover(); recovered == nil || !strings.Contains(recovered.(string), "CreateAgregado") {
			t.Fatalf("the request must reach CreateAgregado (guard passed), got panic=%v status=%d body=%s", recovered, rr.Code, rr.Body.String())
		}
	}()
	srv.HandleAgregados(rr, req)
}
