package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #326: the factory admin manages its sales network — connected store/dealer
// organizations cloned from the factory catalog, with the creator granted an
// admin membership of the new org to invite its team.

func factoryClaims(req *http.Request, orgType string) *http.Request {
	return withOrgClaims(req, "f-admin", "org-factory", string(domain.RoleAdmin))
}

func TestFactoryNetwork_StoreCallerForbidden(t *testing.T) {
	store := &stubStore{
		getOrgByID: &domain.Organization{
			ID: "org-store", Name: "Tienda", Slug: "tienda",
			Type: domain.OrganizationTypeStore, Status: domain.OrganizationStatusActive, CredentialVersion: 1,
		},
	}
	srv := &Server{Store: store}
	req := factoryClaims(httptest.NewRequest(http.MethodGet, "/api/factory/organizations", nil), "store")
	rr := httptest.NewRecorder()

	srv.HandleFactoryOrganizations(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestFactoryNetwork_NonAdminForbidden(t *testing.T) {
	store := &stubStore{
		getOrgByID: &domain.Organization{
			ID: "org-factory", Name: "Fábrica", Slug: "fabrica",
			Type: domain.OrganizationTypeFactory, Status: domain.OrganizationStatusActive, CredentialVersion: 1,
		},
	}
	srv := &Server{Store: store}
	req := withOrgClaims(httptest.NewRequest(http.MethodGet, "/api/factory/organizations", nil),
		"v-1", "org-factory", string(domain.RoleVendedor))
	rr := httptest.NewRecorder()

	srv.HandleFactoryOrganizations(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestFactoryNetwork_ListConnected(t *testing.T) {
	store := &stubStore{
		getOrgByID: &domain.Organization{
			ID: "org-factory", Name: "Fábrica", Slug: "fabrica",
			Type: domain.OrganizationTypeFactory, Status: domain.OrganizationStatusActive, CredentialVersion: 1,
		},
		listConnectedOrgs: []domain.Organization{
			{ID: "org-store-1", Name: "Tienda GDL", Slug: "tienda-gdl", Type: domain.OrganizationTypeStore, Status: domain.OrganizationStatusActive, CredentialVersion: 1},
		},
	}
	srv := &Server{Store: store}
	req := factoryClaims(httptest.NewRequest(http.MethodGet, "/api/factory/organizations", nil), "factory")
	rr := httptest.NewRecorder()

	srv.HandleFactoryOrganizations(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var list []openapi.FactoryOrganization
	if err := json.Unmarshal(rr.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(list) != 1 || list[0].Type != string(domain.OrganizationTypeStore) {
		t.Fatalf("connected list = %+v", list)
	}
}

func TestFactoryNetwork_CreateLegacyRouteRemoved(t *testing.T) {
	store := &stubStore{getOrgByID: &domain.Organization{
		ID: "org-factory", Type: domain.OrganizationTypeFactory,
		Status: domain.OrganizationStatusActive, CredentialVersion: 1,
	}}
	server := &Server{Store: store}
	req := factoryClaims(httptest.NewRequest(http.MethodPost, "/api/factory/organizations", strings.NewReader(`{"name":"Tienda","type":"store"}`)), "factory")
	recorder := httptest.NewRecorder()
	server.HandleFactoryOrganizations(recorder, req)
	if recorder.Code != http.StatusMethodNotAllowed || len(store.createdOrgs) != 0 {
		t.Fatalf("status=%d created=%d body=%s", recorder.Code, len(store.createdOrgs), recorder.Body.String())
	}
}
