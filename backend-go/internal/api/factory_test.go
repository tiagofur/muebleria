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
			Type: domain.OrganizationTypeStore, Active: true,
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
			Type: domain.OrganizationTypeFactory, Active: true,
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
			Type: domain.OrganizationTypeFactory, Active: true,
		},
		listConnectedOrgs: []domain.Organization{
			{ID: "org-store-1", Name: "Tienda GDL", Slug: "tienda-gdl", Type: domain.OrganizationTypeStore, Active: true},
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

func TestFactoryNetwork_CreateStore(t *testing.T) {
	store := &stubStore{
		getOrgByID: &domain.Organization{
			ID: "org-factory", Name: "Fábrica", Slug: "fabrica",
			Type: domain.OrganizationTypeFactory, Active: true,
		},
	}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"name":"Tienda Monterrey","type":"store"}`)
	req := factoryClaims(httptest.NewRequest(http.MethodPost, "/api/factory/organizations", body), "factory")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleFactoryOrganizations(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if len(store.createdOrgs) != 1 {
		t.Fatalf("created orgs = %d, want 1", len(store.createdOrgs))
	}
	created := store.createdOrgs[0]
	if created.Type != domain.OrganizationTypeStore {
		t.Errorf("type = %s, want store", created.Type)
	}
	if created.ParentOrganizationID == nil || *created.ParentOrganizationID != "org-factory" {
		t.Errorf("parent = %v, want org-factory", created.ParentOrganizationID)
	}
	if created.Slug != "tienda-monterrey" {
		t.Errorf("slug = %q, want tiendamonterrey-derived slug", created.Slug)
	}
	if created.LicensePlan != domain.LicensePlanNone {
		t.Errorf("license = %s, want none (licenses are platform-managed)", created.LicensePlan)
	}
	var resp struct {
		Organization openapi.FactoryOrganization `json:"organization"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Organization.ID == "" {
		t.Error("generated organization response is empty")
	}
}

func TestFactoryNetwork_CreateRejectsFactoryType(t *testing.T) {
	// A factory cannot nest factories under itself.
	store := &stubStore{
		getOrgByID: &domain.Organization{
			ID: "org-factory", Name: "Fábrica", Slug: "fabrica",
			Type: domain.OrganizationTypeFactory, Active: true,
		},
	}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"name":"Otra Fábrica","type":"factory"}`)
	req := factoryClaims(httptest.NewRequest(http.MethodPost, "/api/factory/organizations", body), "factory")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleFactoryOrganizations(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
	if len(store.createdOrgs) != 0 {
		t.Fatalf("no org must be created, got %d", len(store.createdOrgs))
	}
}

// The audit trail records the connection with its parent factory.
func TestFactoryNetwork_CreateIsAudited(t *testing.T) {
	store := &stubStore{
		getOrgByID: &domain.Organization{
			ID: "org-factory", Name: "Fábrica", Slug: "fabrica",
			Type: domain.OrganizationTypeFactory, Active: true,
		},
	}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"name":"Dealer Norte","type":"dealer"}`)
	req := factoryClaims(httptest.NewRequest(http.MethodPost, "/api/factory/organizations", body), "factory")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleFactoryOrganizations(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d (body=%s)", rr.Code, rr.Body.String())
	}
	found := false
	for _, ev := range store.auditEvents {
		if ev.EventType == "connected_org_created" {
			found = true
			if ev.OrganizationID != "new-org-1" {
				t.Errorf("audit org = %s, want the new org", ev.OrganizationID)
			}
		}
	}
	if !found {
		t.Fatalf("connected_org_created not audited: %+v", store.auditEvents)
	}
}
