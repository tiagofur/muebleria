package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
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
