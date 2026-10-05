package api

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1091 (#443 slice 2): the simple catalog families share the If-Match write
// guard contract proven for hardware in #1089 — 428 without the header before
// any store call, 412 VERSION_CONFLICT on a stale writer, strong ETag on reads.
func TestCatalogSimpleFamilies_IfMatchGuardsWrites(t *testing.T) {
	catalogPerm := func() string { return string(domain.RoleIngeniero) }

	t.Run("PUT sin If-Match responde 428 y no toca el store", func(t *testing.T) {
		cases := []struct {
			name   string
			path   string
			body   string
			handle func(*Server, http.ResponseWriter, *http.Request)
		}{
			{"material", "/api/catalog/materials/m1", `{"code":"M","name":"N","width_mm":1,"length_mm":2,"thickness_mm":3,"active":true}`, func(s *Server, w http.ResponseWriter, r *http.Request) { s.HandleMaterialByID(w, r) }},
			{"edge", "/api/catalog/edges/e1", `{"code":"E","name":"N","thickness_mm":1,"cost_per_ml":2,"active":true}`, func(s *Server, w http.ResponseWriter, r *http.Request) { s.HandleEdgeBandByID(w, r) }},
			{"option-group", "/api/catalog/option-groups/o1", `{"code":"O","name":"N","kind":"board","required":true}`, func(s *Server, w http.ResponseWriter, r *http.Request) { s.HandleOptionGroupByID(w, r) }},
			{"category", "/api/catalog/categories/c1", `{"name":"N","sort_order":1}`, func(s *Server, w http.ResponseWriter, r *http.Request) { s.HandleCategoryByID(w, r) }},
			{"material-category", "/api/catalog/material-categories/c1", `{"name":"N","sort_order":1}`, func(s *Server, w http.ResponseWriter, r *http.Request) { s.HandleMaterialCategoryByID(w, r) }},
			{"ambient-category", "/api/catalog/ambient-categories/c1", `{"name":"N","sort_order":1}`, func(s *Server, w http.ResponseWriter, r *http.Request) { s.HandleAmbientCategoryByID(w, r) }},
			{"ambient-material", "/api/catalog/ambient-materials/a1", `{"code":"A","name":"N","active":true}`, func(s *Server, w http.ResponseWriter, r *http.Request) { s.HandleAmbientMaterialByID(w, r) }},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				store := &stubStore{}
				req := withClaims(httptest.NewRequest(http.MethodPut, tc.path, strings.NewReader(tc.body)), "eng", catalogPerm())
				req.SetPathValue("id", "x1")
				rr := httptest.NewRecorder()
				tc.handle(&Server{Store: store}, rr, req)
				if rr.Code != http.StatusPreconditionRequired {
					t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
				}
				if !strings.Contains(rr.Body.String(), string(openapi.ApiErrorCodePreconditionRequired)) {
					t.Fatalf("body missing PRECONDITION_REQUIRED: %s", rr.Body.String())
				}
			})
		}
	})

	t.Run("PUT stale responde 412 VERSION_CONFLICT (material, categoría, cliente)", func(t *testing.T) {
		cases := []struct {
			name   string
			body   string
			store  *stubStore
			handle func(*Server, http.ResponseWriter, *http.Request)
		}{
			{"material", `{"code":"M","name":"N","width_mm":1,"length_mm":2,"thickness_mm":3,"active":true}`,
				&stubStore{updateMaterialBoardErr: storage.ErrVersionConflict},
				func(s *Server, w http.ResponseWriter, r *http.Request) { s.HandleMaterialByID(w, r) }},
			{"category", `{"name":"N","sort_order":1}`,
				&stubStore{updateCategoryErr: storage.ErrVersionConflict},
				func(s *Server, w http.ResponseWriter, r *http.Request) { s.HandleCategoryByID(w, r) }},
			{"customer", `{"name":"N","active":true}`,
				&stubStore{customerReturnedByID: &domain.Customer{ID: "x1", Name: "N"}, updateCustomerErr: storage.ErrVersionConflict},
				func(s *Server, w http.ResponseWriter, r *http.Request) { s.HandleCustomerByID(w, r) }},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				role := catalogPerm()
				if tc.name == "customer" {
					role = string(domain.RoleAdmin)
				}
				req := withClaims(httptest.NewRequest(http.MethodPut, "/api/x/x1", strings.NewReader(tc.body)), "admin", role)
				req.Header.Set("If-Match", `"v1"`)
				req.SetPathValue("id", "x1")
				rr := httptest.NewRecorder()
				tc.handle(&Server{Store: tc.store}, rr, req)
				if rr.Code != http.StatusPreconditionFailed {
					t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
				}
				if !strings.Contains(rr.Body.String(), string(openapi.ApiErrorCodeVersionConflict)) {
					t.Fatalf("body missing VERSION_CONFLICT: %s", rr.Body.String())
				}
				_ = errors.Is // keep errors import honest for future assertions
			})
		}
	})

	t.Run("DELETE sin If-Match responde 428", func(t *testing.T) {
		cases := []struct {
			name   string
			path   string
			handle func(*Server, http.ResponseWriter, *http.Request)
		}{
			{"material", "/api/catalog/materials/m1", func(s *Server, w http.ResponseWriter, r *http.Request) { s.HandleMaterialByID(w, r) }},
			{"customer", "/api/customers/c1", func(s *Server, w http.ResponseWriter, r *http.Request) { s.HandleCustomerByID(w, r) }},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				store := &stubStore{}
				role := catalogPerm()
				if tc.name == "customer" {
					role = string(domain.RoleAdmin)
				}
				req := withClaims(httptest.NewRequest(http.MethodDelete, tc.path, nil), "admin", role)
				req.SetPathValue("id", "x1")
				rr := httptest.NewRecorder()
				tc.handle(&Server{Store: store}, rr, req)
				if rr.Code != http.StatusPreconditionRequired {
					t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
				}
			})
		}
	})

	t.Run("GET material expone ETag de versión", func(t *testing.T) {
		store := &stubStore{materialReturnedByID: &domain.MaterialBoard{ID: "m1", Version: 4}}
		req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/materials/m1", nil), "eng", catalogPerm())
		req.SetPathValue("id", "m1")
		rr := httptest.NewRecorder()
		(&Server{Store: store}).HandleMaterialByID(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d", rr.Code)
		}
		if got := rr.Header().Get("ETag"); got != `"v4"` {
			t.Fatalf("ETag = %s, want \"v4\"", got)
		}
	})
}
