package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1130 — the opening profile catalog: reads are any member, writes require
// the catalog-mutation role, and a pending-datasheet profile stores fine but
// is not authorable (the fail-closed gate lives in the contract, #1129).
func TestOpeningProfilesRBACAndCRUD(t *testing.T) {
	pending := domain.OpeningProfile{
		ID: "op-1", Code: "GOLA-L-ALU", Name: "Gola L aluminio",
		GripType: "gola", CrossSectionShape: "L",
		CompatiblePlacements: []string{"top"},
		DatasheetStatus:      "pending",
		Active:               true,
	}
	srv := &Server{Store: &stubStore{openingProfiles: []domain.OpeningProfile{pending}}}

	// Read: any member.
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/opening-profiles", nil), "v1", string(domain.RoleVendedor))
	rr := httptest.NewRecorder()
	srv.HandleOpeningProfiles(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("list status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "GOLA-L-ALU") {
		t.Fatalf("list must expose the seeded pending profile: %s", rr.Body.String())
	}

	// Write: vendedor is rejected.
	req = withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/opening-profiles", strings.NewReader(`{"id":"op-2","code":"X","name":"X","grip_type":"gola","compatible_placements":["top"],"datasheet_status":"pending","active":true}`)), "v1", string(domain.RoleVendedor))
	rr = httptest.NewRecorder()
	srv.HandleOpeningProfiles(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("vendedor POST status = %d, want 403", rr.Code)
	}

	// Write: ingeniero creates; the pending profile persists. #1329: the
	// informational manufacturer rides the create and the readback.
	req = withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/opening-profiles", strings.NewReader(`{"id":"op-2","code":"GOLA-C-ALU","name":"Gola C aluminio","manufacturer":"SCILM","grip_type":"gola","cross_section_shape":"C","compatible_placements":["between"],"datasheet_status":"pending","active":true}`)), "eng", string(domain.RoleIngeniero))
	rr = httptest.NewRecorder()
	srv.HandleOpeningProfiles(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"manufacturer":"SCILM"`) {
		t.Fatalf("create readback must expose the manufacturer: %s", rr.Body.String())
	}

	// #1329: a manufacturer beyond the 120-char bound fails closed at the
	// write boundary instead of storing an unreadable picker line.
	tooLong := strings.Repeat("x", 121)
	body := `{"id":"op-3","code":"GOLA-LONG","name":"Gola larga","manufacturer":"` + tooLong + `","grip_type":"gola","cross_section_shape":"L","compatible_placements":["top"],"datasheet_status":"pending","active":true}`
	req = withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/opening-profiles", strings.NewReader(body)), "eng", string(domain.RoleIngeniero))
	rr = httptest.NewRecorder()
	srv.HandleOpeningProfiles(rr, req)
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("manufacturer-too-long status = %d, want 422 (domain validation rejects)", rr.Code)
	}
}

func TestOpeningProfilesVerifiedRequiresCompleteGeometry(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	// verified SIN geometría completa: el write falla con 422 (la validación
	// de dominio impide el estado que colaría el gate pending).
	body := `{"id":"op-bad","code":"GOLA-BAD","name":"Gola mala","grip_type":"gola","cross_section_shape":"L","compatible_placements":["top"],"datasheet_status":"verified","active":true}`
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/opening-profiles", strings.NewReader(body)), "eng", string(domain.RoleIngeniero))
	rr := httptest.NewRecorder()
	srv.HandleOpeningProfiles(rr, req)
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("verified-incomplete status = %d, want 422 (domain validation rejects)", rr.Code)
	}
}

// B4 (review #1130): version conflicts answer 412 VERSION_CONFLICT and
// missing rows 404 — like the rest of the If-Match catalog family — so the
// web client's "recarga y vuelve a intentar" path works instead of a 500 that
// strands a concurrent editor.
func TestHandleOpeningProfileByIDConflictMaps412(t *testing.T) {
	srv := &Server{Store: &stubStore{openingProfileErr: storage.ErrVersionConflict}}
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/opening-profiles/op-1", strings.NewReader(`{}`)), "eng", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("If-Match", `"v1"`)
	req.SetPathValue("id", "op-1")
	rr := httptest.NewRecorder()
	srv.HandleOpeningProfileByID(rr, req)

	if rr.Code != http.StatusPreconditionFailed {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusPreconditionFailed, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "VERSION_CONFLICT") {
		t.Fatalf("expected the version-conflict code, got %s", rr.Body.String())
	}
}

func TestHandleOpeningProfileByIDMissingMaps404(t *testing.T) {
	srv := &Server{Store: &stubStore{openingProfileErr: storage.ErrOpeningProfileNotFound}}
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/opening-profiles/op-x", strings.NewReader(`{}`)), "eng", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("If-Match", `"v1"`)
	req.SetPathValue("id", "op-x")
	rr := httptest.NewRecorder()
	srv.HandleOpeningProfileByID(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusNotFound)
	}

	// GET on a missing profile is a 404 too, not a 500.
	getReq := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/opening-profiles/op-x", nil), "eng", string(domain.RoleIngeniero))
	getReq.SetPathValue("id", "op-x")
	getRR := httptest.NewRecorder()
	srv.HandleOpeningProfileByID(getRR, getReq)
	if getRR.Code != http.StatusNotFound {
		t.Fatalf("GET status = %d, want %d", getRR.Code, http.StatusNotFound)
	}
}

// #1530 — v2 writes: unknown roles and invalid discounts answer 422 with the
// Spanish message; reads carry the server-computed usage per position.
func TestOpeningProfilesV2WriteRulesAnd422(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	post := func(body string) *httptest.ResponseRecorder {
		req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/opening-profiles", strings.NewReader(body)), "eng", string(domain.RoleIngeniero))
		rr := httptest.NewRecorder()
		srv.HandleOpeningProfiles(rr, req)
		return rr
	}
	base := `"id":"op-v2","code":"GOLA-L","name":"Gola L","material":"aluminum","cross_section_shape":"L","positions":["top"],"profile_height_mm":56.5,"profile_depth_mm":27.2,"active":true`

	rr := post(`{` + base + `,"front_discount_top_mm":52,"bom_members":{"tira":{"hardware_id":"hw","rule":"interior_width"}}}`)
	if rr.Code != http.StatusUnprocessableEntity || !strings.Contains(rr.Body.String(), "no existe") {
		t.Fatalf("unknown role: status=%d body=%s", rr.Code, rr.Body.String())
	}
	rr = post(`{` + base + `,"front_discount_top_mm":0}`)
	if rr.Code != http.StatusUnprocessableEntity || !strings.Contains(rr.Body.String(), "descuento del frente arriba") {
		t.Fatalf("zero discount: status=%d body=%s", rr.Code, rr.Body.String())
	}
	rr = post(`{` + base + `,"positions":["top","between"],"front_discount_top_mm":52}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create: status=%d body=%s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	for _, want := range []string{`"door_reduction_mm":52`, `"grip_type":"gola"`, `"usage":`, `"front_discount_between_mm"`, `descuento del frente entre frentes`} {
		if !strings.Contains(body, want) {
			t.Fatalf("create readback missing %s: %s", want, body)
		}
	}
}

func TestOpeningProfileSuggestionsEndpoint(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/opening-profiles/suggestions?profile_depth_mm=27", nil), "v1", string(domain.RoleVendedor))
	rr := httptest.NewRecorder()
	srv.HandleOpeningProfileSuggestions(rr, req)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"bevel_size_mm":25`) || !strings.Contains(rr.Body.String(), `"front_discount_top_mm":40`) {
		t.Fatalf("suggestions: status=%d body=%s", rr.Code, rr.Body.String())
	}
	req = withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/opening-profiles/suggestions?profile_depth_mm=-3", nil), "v1", string(domain.RoleVendedor))
	rr = httptest.NewRecorder()
	srv.HandleOpeningProfileSuggestions(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("negative depth: status=%d", rr.Code)
	}
}
