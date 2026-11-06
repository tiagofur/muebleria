package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1531 — grip styles API: reads for any member, writes need the catalog
// role and If-Match, validation answers 422 in Spanish, version conflicts 412.
func TestGripStylesHandlers(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	body := `{"name":"Rebase","offered":true,"isDefault":false,"byFurnitureType":{"inferior":{"mode":"handle"},"superior":{"mode":"bottom_overhang"},"alto":{"mode":"handle"}}}`

	post := func(role, payload string) *httptest.ResponseRecorder {
		req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/grip-styles", strings.NewReader(payload)), "u", role)
		rr := httptest.NewRecorder()
		srv.HandleGripStyles(rr, req)
		return rr
	}
	if rr := post(string(domain.RoleVendedor), body); rr.Code != http.StatusForbidden {
		t.Fatalf("vendedor POST = %d, want 403", rr.Code)
	}
	rr := post(string(domain.RoleIngeniero), body)
	if rr.Code != http.StatusCreated || !strings.Contains(rr.Body.String(), `"overhangMm":20`) || rr.Header().Get("ETag") == "" {
		t.Fatalf("create = %d %s (ETag %q)", rr.Code, rr.Body.String(), rr.Header().Get("ETag"))
	}
	for _, bad := range []string{`0`, `-3`, `12.5`} {
		payload := strings.Replace(body, `{"mode":"bottom_overhang"}`, `{"mode":"bottom_overhang","overhangMm":`+bad+`}`, 1)
		if rr := post(string(domain.RoleIngeniero), payload); rr.Code != http.StatusUnprocessableEntity || !strings.Contains(rr.Body.String(), "entero de milímetros") {
			t.Fatalf("overhang %s = %d %s, want 422", bad, rr.Code, rr.Body.String())
		}
	}
	if rr := post(string(domain.RoleIngeniero), strings.Replace(body, `"inferior":{"mode":"handle"}`, `"inferior":{"mode":"wood"}`, 1)); rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("unknown mode = %d, want 422", rr.Code)
	}

	// Read is open to any member.
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/grip-styles", nil), "v", string(domain.RoleVendedor))
	rr = httptest.NewRecorder()
	srv.HandleGripStyles(rr, req)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "Rebase") {
		t.Fatalf("list = %d %s", rr.Code, rr.Body.String())
	}

	// PUT without If-Match → 428; stale If-Match → 412.
	put := func(ifMatch string) *httptest.ResponseRecorder {
		req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/grip-styles/gs-1", strings.NewReader(body)), "u", string(domain.RoleIngeniero))
		req.SetPathValue("id", "gs-1")
		if ifMatch != "" {
			req.Header.Set("If-Match", ifMatch)
		}
		rr := httptest.NewRecorder()
		srv.HandleGripStyleByID(rr, req)
		return rr
	}
	if rr := put(""); rr.Code != http.StatusPreconditionRequired {
		t.Fatalf("PUT without If-Match = %d, want 428", rr.Code)
	}
	if rr := put(`"v9"`); rr.Code != http.StatusPreconditionFailed {
		t.Fatalf("stale PUT = %d, want 412", rr.Code)
	}
	if rr := put(`"v1"`); rr.Code != http.StatusOK || rr.Header().Get("ETag") != `"v2"` {
		t.Fatalf("PUT = %d ETag %q", rr.Code, rr.Header().Get("ETag"))
	}
}
