package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1382: organizations on the canonical Standard library cannot author
// catalog geometry; the server enforces it independently of the UI.

func geometryWriteStatus(t *testing.T, lib domain.LibraryType, method, path, id string, handler func(*Server) http.HandlerFunc) int {
	t.Helper()
	store := &stubStore{getOrgByID: &domain.Organization{
		ID: "org-1", Type: domain.OrganizationTypeFactory, LicensePlan: domain.LicensePlanPro,
		Status: domain.OrganizationStatusActive, LibraryType: lib,
	}, moduleReturnedByID: &domain.Module{ID: "mod1"}}
	req := withClaims(httptest.NewRequest(method, path, strings.NewReader(`{}`)), "eng", string(domain.RoleIngeniero))
	if id != "" {
		req.SetPathValue("id", id)
	}
	rr := httptest.NewRecorder()
	handler(&Server{Store: store})(rr, req)
	return rr.Code
}

func TestStandardLibraryBlocksGeometryAuthoring(t *testing.T) {
	cases := []struct {
		name    string
		method  string
		path    string
		id      string
		handler func(*Server) http.HandlerFunc
	}{
		{"create module", http.MethodPost, "/api/catalog/modules", "", func(s *Server) http.HandlerFunc { return s.HandleModules }},
		{"update module", http.MethodPut, "/api/catalog/modules/mod1", "mod1", func(s *Server) http.HandlerFunc { return s.HandleModuleByID }},
		{"delete module", http.MethodDelete, "/api/catalog/modules/mod1", "mod1", func(s *Server) http.HandlerFunc { return s.HandleModuleByID }},
		{"create structure", http.MethodPost, "/api/catalog/structures", "", func(s *Server) http.HandlerFunc { return s.HandleStructures }},
		{"update structure", http.MethodPut, "/api/catalog/structures/s1", "s1", func(s *Server) http.HandlerFunc { return s.HandleStructureByID }},
		{"delete structure", http.MethodDelete, "/api/catalog/structures/s1", "s1", func(s *Server) http.HandlerFunc { return s.HandleStructureByID }},
		{"create component", http.MethodPost, "/api/catalog/components", "", func(s *Server) http.HandlerFunc { return s.HandleComponents }},
		{"update component", http.MethodPut, "/api/catalog/components/c1", "c1", func(s *Server) http.HandlerFunc { return s.HandleComponentByID }},
		{"delete component", http.MethodDelete, "/api/catalog/components/c1", "c1", func(s *Server) http.HandlerFunc { return s.HandleComponentByID }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := geometryWriteStatus(t, domain.LibraryTypeStandard, tc.method, tc.path, tc.id, tc.handler); got != http.StatusForbidden {
				t.Fatalf("standard library: status = %d, want 403", got)
			}
			if got := geometryWriteStatus(t, "", tc.method, tc.path, tc.id, tc.handler); got != http.StatusForbidden {
				t.Fatalf("empty library type must fail closed: status = %d, want 403", got)
			}
		})
	}
}

func TestCustomLibraryPassesGeometryGuard(t *testing.T) {
	store := &stubStore{getOrgByID: &domain.Organization{
		ID: "org-1", Type: domain.OrganizationTypeFactory, LicensePlan: domain.LicensePlanPro,
		Status: domain.OrganizationStatusActive, LibraryType: domain.LibraryTypeCustom,
	}}
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/modules", nil), "eng", string(domain.RoleIngeniero))
	rr := httptest.NewRecorder()
	if !(&Server{Store: store}).requireGeometryAuthoring(rr, req) {
		t.Fatalf("custom library must pass the guard, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestStandardLibraryKeepsCatalogReadsOpen(t *testing.T) {
	store := &stubStore{getOrgByID: &domain.Organization{
		ID: "org-1", Type: domain.OrganizationTypeFactory, LicensePlan: domain.LicensePlanPro,
		Status: domain.OrganizationStatusActive, LibraryType: domain.LibraryTypeStandard,
	}}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/structures", nil), "eng", string(domain.RoleIngeniero))
	rr := httptest.NewRecorder()
	(&Server{Store: store}).HandleStructures(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("GET structures on standard library = %d, want 200", rr.Code)
	}
}
