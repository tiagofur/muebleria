package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1417: the hardware write path validates design parts fail-closed —
// an invalid recipe of parts is rejected with a typed 422 and nothing is
// persisted. Legacy payloads without parts never hit the validator.
func TestHandleHardwaresPostRejectsInvalidDesignParts(t *testing.T) {
	srv := &Server{Store: &stubStore{}}

	body := strings.NewReader(`{
		"code":"CORR-X","name":"Corredera X","unit":"piece","cost_per_unit":0,"active":true,
		"design_parts":[{"componentName":"  ","actorMembership":"body"}]
	}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/hardware", body), "admin", string(domain.RoleAdmin))
	rr := httptest.NewRecorder()
	srv.HandleHardwares(rr, req)

	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "HARDWARE_DESIGN_PARTS_INVALID") {
		t.Fatalf("body missing typed code: %s", rr.Body.String())
	}
}

func TestHandleHardwareByIDPutRejectsInvalidDesignParts(t *testing.T) {
	srv := &Server{Store: &stubStore{}}

	body := strings.NewReader(`{
		"code":"CORR-X","name":"Corredera X","unit":"piece","cost_per_unit":0,"active":true,
		"design_parts":[{"componentName":"riel","actorMembership":"no-es-actor"}]
	}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/hardware/h1", body), "admin", string(domain.RoleAdmin))
	req.Header.Set("If-Match", `"v1"`)
	req.SetPathValue("id", "h1")
	rr := httptest.NewRecorder()
	srv.HandleHardwareByID(rr, req)

	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "HARDWARE_DESIGN_PARTS_INVALID") {
		t.Fatalf("body missing typed code: %s", rr.Body.String())
	}
}
