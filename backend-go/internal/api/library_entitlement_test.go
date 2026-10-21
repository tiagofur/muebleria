package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1382: organizations on the canonical Standard library cannot author
// catalog geometry; the server enforces it independently of the UI.

func geometryWriteStatus(t *testing.T, lib domain.LibraryType, method, path, id string, handler func(*Server) http.HandlerFunc) (int, string) {
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
	return rr.Code, rr.Body.String()
}

// customLibraryOrg is the organization stub a handler test needs to pass the
// geometry guard when the test is not about the entitlement itself.
func customLibraryOrg() *domain.Organization {
	return &domain.Organization{
		ID: storage.InitialOrganizationID, Type: domain.OrganizationTypeFactory,
		Status: domain.OrganizationStatusActive, LibraryType: domain.LibraryTypeCustom,
	}
}

// guardRefusal is the fragment every entitlement refusal carries; asserting it
// proves the 403 came from the library guard and not from role permissions.
const guardRefusal = "biblioteca estándar de Granete"

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
		// Surfaces the UI hides for standard workshops but the server left open
		// until the 2026-10-21 pre-sale review: agregados, component side
		// assignments (part of the component definition) and finishes.
		{"create agregado", http.MethodPost, "/api/catalog/agregados", "", func(s *Server) http.HandlerFunc { return s.HandleAgregados }},
		{"update agregado", http.MethodPut, "/api/catalog/agregados/a1", "a1", func(s *Server) http.HandlerFunc { return s.HandleAgregadoByID }},
		{"delete agregado", http.MethodDelete, "/api/catalog/agregados/a1", "a1", func(s *Server) http.HandlerFunc { return s.HandleAgregadoByID }},
		{"set component side assignment", http.MethodPut, "/api/catalog/components/c1/side-assignments", "c1", func(s *Server) http.HandlerFunc { return s.HandleComponentSideAssignments }},
		{"remove component side assignment", http.MethodDelete, "/api/catalog/components/c1/side-assignments/front", "c1", func(s *Server) http.HandlerFunc { return s.HandleComponentSideAssignments }},
		{"create ambient material", http.MethodPost, "/api/catalog/ambient-materials", "", func(s *Server) http.HandlerFunc { return s.HandleAmbientMaterials }},
		{"update ambient material", http.MethodPut, "/api/catalog/ambient-materials/am1", "am1", func(s *Server) http.HandlerFunc { return s.HandleAmbientMaterialByID }},
		{"delete ambient material", http.MethodDelete, "/api/catalog/ambient-materials/am1", "am1", func(s *Server) http.HandlerFunc { return s.HandleAmbientMaterialByID }},
		{"create ambient category", http.MethodPost, "/api/catalog/ambient-categories", "", func(s *Server) http.HandlerFunc { return s.HandleAmbientCategories }},
		{"update ambient category", http.MethodPut, "/api/catalog/ambient-categories/ac1", "ac1", func(s *Server) http.HandlerFunc { return s.HandleAmbientCategoryByID }},
		{"delete ambient category", http.MethodDelete, "/api/catalog/ambient-categories/ac1", "ac1", func(s *Server) http.HandlerFunc { return s.HandleAmbientCategoryByID }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got, body := geometryWriteStatus(t, domain.LibraryTypeStandard, tc.method, tc.path, tc.id, tc.handler); got != http.StatusForbidden || !strings.Contains(body, guardRefusal) {
				t.Fatalf("standard library: status = %d body = %s, want 403 from the library guard", got, body)
			}
			if got, body := geometryWriteStatus(t, "", tc.method, tc.path, tc.id, tc.handler); got != http.StatusForbidden || !strings.Contains(body, guardRefusal) {
				t.Fatalf("empty library type must fail closed: status = %d body = %s, want 403 from the library guard", got, body)
			}
		})
	}
}

func TestGeometryGuardNamesTheSurface(t *testing.T) {
	cases := []struct {
		name    string
		method  string
		path    string
		id      string
		surface string
		handler func(*Server) http.HandlerFunc
	}{
		{"module", http.MethodPost, "/api/catalog/modules", "", "muebles, estructuras y componentes", func(s *Server) http.HandlerFunc { return s.HandleModules }},
		{"agregado", http.MethodPost, "/api/catalog/agregados", "", "agregados", func(s *Server) http.HandlerFunc { return s.HandleAgregados }},
		{"side assignment", http.MethodPut, "/api/catalog/components/c1/side-assignments", "c1", "componentes", func(s *Server) http.HandlerFunc { return s.HandleComponentSideAssignments }},
		{"finish", http.MethodPost, "/api/catalog/ambient-materials", "", "acabados", func(s *Server) http.HandlerFunc { return s.HandleAmbientMaterials }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, body := geometryWriteStatus(t, domain.LibraryTypeStandard, tc.method, tc.path, tc.id, tc.handler)
			if !strings.Contains(body, "La edición de "+tc.surface+" requiere") {
				t.Fatalf("refusal must name the surface %q, got %s", tc.surface, body)
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
