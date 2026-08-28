package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #327 hardening: project organization ownership is server-authoritative.
// Create validates the requested organizations against the caller's live
// memberships (manufacturing must be a factory); update ignores client copies
// and sales-organization callers never see — nor wipe — manufacturing data.

func withOrgClaims(req *http.Request, userID, orgID string, roles ...string) *http.Request {
	claims := &auth.Claims{
		UserID: userID, OrgID: orgID, Email: userID + "@test.com",
		Roles: roles,
	}
	if len(roles) > 0 {
		claims.Role = roles[0]
	}
	return req.WithContext(context.WithValue(req.Context(), UserContextKey, claims))
}

func membershipFor(userID, orgID string, orgType domain.OrganizationType, roles ...domain.UserRole) domain.MembershipWithOrg {
	return domain.MembershipWithOrg{
		Membership: domain.Membership{
			OrganizationID: orgID, UserID: userID,
			Roles: roles, Active: true,
		},
		Organization: domain.Organization{
			ID: orgID, Name: "Org " + orgID, Slug: orgID, Type: orgType, Active: true,
		},
	}
}

func orgIDs(t *testing.T, rr *httptest.ResponseRecorder) (sales, mfg string) {
	t.Helper()
	var p domain.Project
	if err := json.Unmarshal(rr.Body.Bytes(), &p); err != nil {
		t.Fatalf("decoding response: %v (body=%s)", err, rr.Body.String())
	}
	return p.SalesOrganizationID, p.ManufacturingOrganizationID
}

func TestProjectOrgOwnership_CreateRejectsForeignOrg(t *testing.T) {
	const orgSales, orgOther = "org-sales", "org-other"
	srv := &Server{Store: &stubStore{
		membershipsByUser: map[string][]domain.MembershipWithOrg{
			"u1": {membershipFor("u1", orgSales, domain.OrganizationTypeStore, domain.RoleVendedor)},
		},
	}}
	body := strings.NewReader(`{"name":"Cocina","customer_id":"11111111-1111-1111-1111-111111111111","currency":"MXN","manufacturing_organization_id":"` + orgOther + `"}`)
	req := withOrgClaims(httptest.NewRequest(http.MethodPost, "/api/projects", body), "u1", orgSales, string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjects(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (body=%s)", rr.Code, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "no pertenecés") {
		t.Errorf("error message = %q, want it to mention membership", msg)
	}
}

func TestProjectOrgOwnership_CreateRejectsNonFactoryMfg(t *testing.T) {
	const orgSales, orgStoreFriend = "org-sales", "org-store-friend"
	srv := &Server{Store: &stubStore{
		membershipsByUser: map[string][]domain.MembershipWithOrg{
			"u1": {
				membershipFor("u1", orgSales, domain.OrganizationTypeStore, domain.RoleVendedor),
				membershipFor("u1", orgStoreFriend, domain.OrganizationTypeStore, domain.RoleVendedor),
			},
		},
	}}
	// Caller IS a member of orgStoreFriend, but it is a store, not a factory.
	body := strings.NewReader(`{"name":"Cocina","customer_id":"11111111-1111-1111-1111-111111111111","currency":"MXN","manufacturing_organization_id":"` + orgStoreFriend + `"}`)
	req := withOrgClaims(httptest.NewRequest(http.MethodPost, "/api/projects", body), "u1", orgSales, string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjects(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (body=%s)", rr.Code, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "fábrica") {
		t.Errorf("error message = %q, want it to mention factory requirement", msg)
	}
}

func TestProjectOrgOwnership_CreateAllowsOwnFactoryMembership(t *testing.T) {
	const orgSales, orgFactory = "org-sales", "org-factory"
	store := &stubStore{
		membershipsByUser: map[string][]domain.MembershipWithOrg{
			"u1": {
				membershipFor("u1", orgSales, domain.OrganizationTypeStore, domain.RoleVendedor),
				membershipFor("u1", orgFactory, domain.OrganizationTypeFactory, domain.RoleIngeniero),
			},
		},
	}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"name":"Cocina","customer_id":"11111111-1111-1111-1111-111111111111","currency":"MXN","sales_organization_id":"` + orgSales + `","manufacturing_organization_id":"` + orgFactory + `"}`)
	req := withOrgClaims(httptest.NewRequest(http.MethodPost, "/api/projects", body), "u1", orgSales, string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjects(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.lastCreatedProject == nil {
		t.Fatal("project was not persisted by the stub")
	}
	if got := store.lastCreatedProject.SalesOrganizationID; got != orgSales {
		t.Errorf("sales org = %q, want %q", got, orgSales)
	}
	if got := store.lastCreatedProject.ManufacturingOrganizationID; got != orgFactory {
		t.Errorf("mfg org = %q, want %q", got, orgFactory)
	}
}

// A sales-organization caller must not receive manufacturing-internal data
// for a project manufactured by another organization (#327 no-leak rule).
func TestProjectOrgOwnership_GetRedactsManufacturingForSalesOrg(t *testing.T) {
	const orgSales, orgFactory = "org-sales", "org-factory"
	existing := &domain.Project{
		ID:                          "p1",
		Name:                        "Cocina compartida",
		OwnerUserID:                 "u1",
		SalesOrganizationID:         orgSales,
		ManufacturingOrganizationID: orgFactory,
		CutPlan:                     json.RawMessage(`{"sheets":1}`),
		EngineeringLog:              json.RawMessage(`[{"e":"cut"}]`),
		PartInstances:               []domain.PartInstance{{ID: "pi1"}},
	}
	srv := &Server{Store: &stubStore{projectReturnedByID: existing}}
	req := withOrgClaims(httptest.NewRequest(http.MethodGet, "/api/projects/p1", nil), "u1", orgSales, string(domain.RoleVendedor))
	req.SetPathValue("id", "p1")
	rr := httptest.NewRecorder()

	srv.HandleProjectByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var got domain.Project
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if got.CutPlan != nil || got.EngineeringLog != nil || len(got.PartInstances) != 0 {
		t.Fatalf("sales org must not see manufacturing data: cut=%v log=%v parts=%d",
			got.CutPlan != nil, got.EngineeringLog != nil, len(got.PartInstances))
	}
	// Commercial identity stays visible so the store can keep selling.
	if got.SalesOrganizationID != orgSales || got.ManufacturingOrganizationID != orgFactory {
		t.Errorf("org identity must stay visible: sales=%q mfg=%q", got.SalesOrganizationID, got.ManufacturingOrganizationID)
	}
}

// The manufacturing organization always sees the full payload.
func TestProjectOrgOwnership_GetKeepsManufacturingForFactoryOrg(t *testing.T) {
	const orgSales, orgFactory = "org-sales", "org-factory"
	existing := &domain.Project{
		ID:                          "p1",
		Name:                        "Cocina compartida",
		SalesOrganizationID:         orgSales,
		ManufacturingOrganizationID: orgFactory,
		CutPlan:                     json.RawMessage(`{"sheets":1}`),
	}
	srv := &Server{Store: &stubStore{projectReturnedByID: existing}}
	req := withOrgClaims(httptest.NewRequest(http.MethodGet, "/api/projects/p1", nil), "u2", orgFactory, string(domain.RoleProduccion))
	req.SetPathValue("id", "p1")
	rr := httptest.NewRecorder()

	srv.HandleProjectByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var got domain.Project
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if got.CutPlan == nil {
		t.Fatal("manufacturing org must see the cut plan")
	}
}

// Update must ignore client-sent ownership copies and must not let a sales
// caller's round-trip PUT wipe the manufacturing payload.
func TestProjectOrgOwnership_UpdatePreservesOwnershipAndManufacturing(t *testing.T) {
	const orgSales, orgFactory, orgEvil = "org-sales", "org-factory", "org-evil"
	existing := &domain.Project{
		ID:                          "p1",
		Name:                        "Cocina compartida",
		Status:                      domain.StatusDraft,
		OwnerUserID:                 "u1",
		SalesOrganizationID:         orgSales,
		ManufacturingOrganizationID: orgFactory,
		CutPlan:                     json.RawMessage(`{"sheets":1}`),
		EngineeringLog:              json.RawMessage(`[{"e":"cut"}]`),
	}
	store := &stubStore{projectReturnedByID: existing}
	srv := &Server{Store: store}
	// The sales caller attempts to repoint both orgs at orgEvil.
	body := strings.NewReader(`{"id":"p1","name":"Hack","customer_id":"11111111-1111-1111-1111-111111111111","currency":"MXN","owner_user_id":"u1","status":"draft","items":[],` +
		`"sales_organization_id":"` + orgEvil + `","manufacturing_organization_id":"` + orgEvil + `"}`)
	req := withOrgClaims(httptest.NewRequest(http.MethodPut, "/api/projects/p1", body), "u1", orgSales, string(domain.RoleVendedor))
	req.SetPathValue("id", "p1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjectByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	sales, mfg := orgIDs(t, rr)
	if sales != orgSales || mfg != orgFactory {
		t.Fatalf("ownership was reassigned: sales=%q mfg=%q, want %q/%q", sales, mfg, orgSales, orgFactory)
	}
	if store.lastUpdatedProject == nil {
		t.Fatal("update did not reach the stub store")
	}
	upd := store.lastUpdatedProject
	if upd.SalesOrganizationID != orgSales || upd.ManufacturingOrganizationID != orgFactory {
		t.Fatalf("persisted ownership changed: sales=%q mfg=%q", upd.SalesOrganizationID, upd.ManufacturingOrganizationID)
	}
	if upd.CutPlan == nil || upd.EngineeringLog == nil {
		t.Fatal("sales PUT must restore (not wipe) the stored manufacturing payload")
	}
}

// F178: manufacturing subresources are factory-only. The wrapper returns the
// same 404 as a missing project for the sales org (never confirms existence)
// and passes the manufacturing org through.
func TestManufacturingOnly_RouteGate(t *testing.T) {
	const orgSales, orgFactory = "org-sales", "org-factory"
	newSrv := func() *Server {
		return &Server{Store: &stubStore{projectReturnedByID: &domain.Project{
			ID:                          "p1",
			Name:                        "Split",
			SalesOrganizationID:         orgSales,
			ManufacturingOrganizationID: orgFactory,
		}}}
	}
	wrapped := func(srv *Server) http.HandlerFunc {
		return srv.manufacturingOnly(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))
	}

	req := withOrgClaims(httptest.NewRequest(http.MethodGet, "/api/projects/p1/part-executions", nil),
		"u1", orgSales, string(domain.RoleAdmin))
	req.SetPathValue("id", "p1")
	rr := httptest.NewRecorder()
	wrapped(newSrv()).ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("sales org on manufacturing route: got %d, want 404 (body=%s)", rr.Code, rr.Body.String())
	}

	req = withOrgClaims(httptest.NewRequest(http.MethodGet, "/api/projects/p1/part-executions", nil),
		"u2", orgFactory, string(domain.RoleProduccion))
	req.SetPathValue("id", "p1")
	rr = httptest.NewRecorder()
	wrapped(newSrv()).ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("manufacturing org on manufacturing route: got %d, want 200", rr.Code)
	}
}

// F178: a store cannot be its own manufacturer — the escape hatch that made
// the sales/manufacturing split never apply is closed.
func TestProjectOrgOwnership_StoreNeedsFactory(t *testing.T) {
	const orgStore, orgFactory = "org-store", "org-factory"
	store := &stubStore{
		membershipsByUser: map[string][]domain.MembershipWithOrg{
			"u1": {
				membershipFor("u1", orgStore, domain.OrganizationTypeStore, domain.RoleAdmin),
				membershipFor("u1", orgFactory, domain.OrganizationTypeFactory, domain.RoleIngeniero),
			},
		},
	}
	srv := &Server{Store: store}

	// No mfg assigned → store would become its own manufacturer → 400.
	body := strings.NewReader(`{"name":"Cocina tienda","customer_id":"11111111-1111-1111-1111-111111111111","currency":"MXN"}`)
	req := withOrgClaims(httptest.NewRequest(http.MethodPost, "/api/projects", body), "u1", orgStore, string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleProjects(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("store without factory mfg: got %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}

	// Explicit factory mfg → allowed.
	body = strings.NewReader(`{"name":"Cocina tienda","customer_id":"11111111-1111-1111-1111-111111111111","currency":"MXN","manufacturing_organization_id":"` + orgFactory + `"}`)
	req = withOrgClaims(httptest.NewRequest(http.MethodPost, "/api/projects", body), "u1", orgStore, string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	rr = httptest.NewRecorder()
	srv.HandleProjects(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("store with factory mfg: got %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
}

// F178: the aggregate redaction also covers the subprocess payloads loaded by
// GetProjectByID (MRP planning, quality, job costing).
func TestProjectOrgOwnership_GetRedactsSubprocessesForSalesOrg(t *testing.T) {
	const orgSales, orgFactory = "org-sales", "org-factory"
	existing := &domain.Project{
		ID:                          "p1",
		Name:                        "Split",
		OwnerUserID:                 "u1",
		SalesOrganizationID:         orgSales,
		ManufacturingOrganizationID: orgFactory,
		CutPlan:                     json.RawMessage(`{"sheets":1}`),
		MaterialPlanning:            &domain.MaterialPlanning{ID: "mrp-1"},
		Quality:                     &domain.QualityJob{ID: "q-1"},
		Costing:                     &domain.JobCosting{ID: "jc-1"},
	}
	srv := &Server{Store: &stubStore{projectReturnedByID: existing}}
	req := withOrgClaims(httptest.NewRequest(http.MethodGet, "/api/projects/p1", nil), "u1", orgSales, string(domain.RoleVendedor))
	req.SetPathValue("id", "p1")
	rr := httptest.NewRecorder()

	srv.HandleProjectByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d (body=%s)", rr.Code, rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), "material_planning") ||
		strings.Contains(rr.Body.String(), "quality") ||
		strings.Contains(rr.Body.String(), "costing") ||
		strings.Contains(rr.Body.String(), "cut_plan") {
		t.Fatalf("sales org must not see manufacturing/subprocess payloads: %s", rr.Body.String())
	}
}
