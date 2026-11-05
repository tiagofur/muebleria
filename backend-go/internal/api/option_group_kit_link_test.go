package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1502: el kit accesorio declarado por un grupo de opción se valida
// server-side, fail-closed: kind hardware, kit existente y activo. El caso
// "miembro = parte del MISMO kit del grupo" queda cubierto por el guard más
// fuerte de #1436 (una parte nunca es opción), probado abajo.

func optionGroupKitLinkFixture() []domain.Hardware {
	return []domain.Hardware{
		{ID: "kit-mbox-e", Code: "MBOX-IRIDIUN-E", Name: "MERIVOBOX E", Unit: "set", Active: true},
		{ID: "kit-acc-gal", Code: "KIT-E-GAL", Name: "Galería E", Unit: "set", Active: true},
		{ID: "kit-acc-off", Code: "KIT-E-OFF", Name: "Boxcap E (inactivo)", Unit: "set", Active: false},
	}
}

func TestHandleOptionGroupsPostRejectsKitLinkOnBoardKind(t *testing.T) {
	srv := &Server{Store: &stubStore{listHardwares: optionGroupKitLinkFixture()}}

	body := strings.NewReader(`{
		"code":"LATERAL_E","name":"Lateral E","kind":"board","required":true,
		"option_ids":["mat-x"],"kit_hardware_id":"kit-mbox-e"
	}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/option-groups", body), "admin", string(domain.RoleAdmin))
	rr := httptest.NewRecorder()
	srv.HandleOptionGroups(rr, req)

	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "OPTION_GROUP_KIT_LINK_INVALID") {
		t.Fatalf("body missing typed code: %s", rr.Body.String())
	}
}

func TestHandleOptionGroupsPostRejectsUnknownKit(t *testing.T) {
	srv := &Server{Store: &stubStore{listHardwares: optionGroupKitLinkFixture()}}

	body := strings.NewReader(`{
		"code":"LATERAL_E","name":"Lateral E","kind":"hardware","required":true,
		"option_ids":["kit-acc-gal"],"kit_hardware_id":"kit-fantasma"
	}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/option-groups", body), "admin", string(domain.RoleAdmin))
	rr := httptest.NewRecorder()
	srv.HandleOptionGroups(rr, req)

	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "OPTION_GROUP_KIT_LINK_INVALID") {
		t.Fatalf("body missing typed code: %s", rr.Body.String())
	}
}

func TestHandleOptionGroupsPostRejectsInactiveKit(t *testing.T) {
	srv := &Server{Store: &stubStore{
		listHardwares:        optionGroupKitLinkFixture(),
		hardwareReturnedByID: &domain.Hardware{ID: "kit-acc-off", Code: "KIT-E-OFF", Name: "Boxcap E", Unit: "set", Active: false},
	}}

	body := strings.NewReader(`{
		"code":"LATERAL_E","name":"Lateral E","kind":"hardware","required":true,
		"option_ids":["kit-acc-gal"],"kit_hardware_id":"kit-acc-off"
	}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/option-groups", body), "admin", string(domain.RoleAdmin))
	rr := httptest.NewRecorder()
	srv.HandleOptionGroups(rr, req)

	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "inactivo") {
		t.Fatalf("body must name the inactive kit: %s", rr.Body.String())
	}
}

func TestHandleOptionGroupsPostAcceptsValidKitLink(t *testing.T) {
	srv := &Server{Store: &stubStore{
		listHardwares:          optionGroupKitLinkFixture(),
		hardwareReturnedByID:   &domain.Hardware{ID: "kit-mbox-e", Code: "MBOX-IRIDIUN-E", Name: "MERIVOBOX E", Unit: "set", Active: true},
		createOptionGroupArmed: true,
	}}

	body := strings.NewReader(`{
		"code":"LATERAL_E","name":"Lateral E","kind":"hardware","required":true,
		"option_ids":["kit-acc-gal"],"kit_hardware_id":"kit-mbox-e"
	}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/option-groups", body), "admin", string(domain.RoleAdmin))
	rr := httptest.NewRecorder()
	srv.HandleOptionGroups(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
}

// Un valor vacío (trimmed) en el wire normaliza a sin link — es la forma en
// que el editor limpia la asociación.
func TestHandleOptionGroupsPostNormalizesEmptyKitLink(t *testing.T) {
	srv := &Server{Store: &stubStore{
		listHardwares:          optionGroupKitLinkFixture(),
		createOptionGroupArmed: true,
	}}

	body := strings.NewReader(`{
		"code":"LATERAL_E","name":"Lateral E","kind":"hardware","required":false,
		"option_ids":["kit-acc-gal"],"kit_hardware_id":"  "
	}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/option-groups", body), "admin", string(domain.RoleAdmin))
	rr := httptest.NewRecorder()
	srv.HandleOptionGroups(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestHandleOptionGroupByIDPutRejectsUnknownKitLink(t *testing.T) {
	srv := &Server{Store: &stubStore{listHardwares: optionGroupKitLinkFixture(), updateOptionGroupArmed: true}}

	body := strings.NewReader(`{
		"code":"LATERAL_E","name":"Lateral E","kind":"hardware","required":true,
		"option_ids":["kit-acc-gal"],"kit_hardware_id":"kit-fantasma"
	}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/option-groups/og1", body), "admin", string(domain.RoleAdmin))
	req.Header.Set("If-Match", `"v1"`)
	req.SetPathValue("id", "og1")
	rr := httptest.NewRecorder()
	srv.HandleOptionGroupByID(rr, req)

	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "OPTION_GROUP_KIT_LINK_INVALID") {
		t.Fatalf("body missing typed code: %s", rr.Body.String())
	}
}

// El guard de doble materialización (parte del MISMO kit del grupo como
// miembro): #1436 ya lo rechaza con el código más fuerte — un kit accesorio
// nunca es una parte individual.
func TestHandleOptionGroupsPostRejectsSameKitPartMember(t *testing.T) {
	srv := &Server{Store: &stubStore{listHardwares: []domain.Hardware{
		{ID: "kit-494", Code: "49402645", Name: "Set corredera", Unit: "set", Active: true},
		{ID: "parte-fij-i", Code: "49402645-FIJ-I", Name: "Guía fija izquierda", Unit: "piece", Active: true, KitHardwareID: kitLink("kit-494")},
	}}}

	body := strings.NewReader(`{
		"code":"ACC_494","name":"Accesorio corredera","kind":"hardware","required":false,
		"option_ids":["parte-fij-i"],"kit_hardware_id":"kit-494"
	}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/option-groups", body), "admin", string(domain.RoleAdmin))
	rr := httptest.NewRecorder()
	srv.HandleOptionGroups(rr, req)

	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "OPTION_GROUP_KIT_PART") {
		t.Fatalf("body must carry the #1436 guard code (double materialization), got: %s", rr.Body.String())
	}
}
