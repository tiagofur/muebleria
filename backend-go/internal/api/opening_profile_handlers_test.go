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

	// Write: ingeniero creates; the pending profile persists.
	req = withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/opening-profiles", strings.NewReader(`{"id":"op-2","code":"GOLA-C-ALU","name":"Gola C aluminio","grip_type":"gola","cross_section_shape":"C","compatible_placements":["between"],"datasheet_status":"pending","active":true}`)), "eng", string(domain.RoleIngeniero))
	rr = httptest.NewRecorder()
	srv.HandleOpeningProfiles(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestOpeningProfilesVerifiedRequiresCompleteGeometry(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	// verified SIN geometría completa ni origen: el write falla (la validación
	// de dominio impide el estado que colaría el gate pending).
	body := `{"id":"op-bad","code":"GOLA-BAD","name":"Gola mala","grip_type":"gola","cross_section_shape":"L","compatible_placements":["top"],"datasheet_status":"verified","active":true}`
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/opening-profiles", strings.NewReader(body)), "eng", string(domain.RoleIngeniero))
	rr := httptest.NewRecorder()
	srv.HandleOpeningProfiles(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("verified-incomplete status = %d, want 500 (domain validation rejects)", rr.Code)
	}
}

// B4 (review #1130): version conflicts answer 412 VERSION_CONFLICT and
// missing rows 404 — like the rest of the If-Match catalog family — so the
// web client's "recargá y reintentá" path works instead of a 500 that
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
