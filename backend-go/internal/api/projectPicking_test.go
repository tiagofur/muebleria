package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestPicking_ListVisibleToPurchasingRoles(t *testing.T) {
	store := &stubStore{
		pickingList: []domain.ProjectPicking{
			{ProjectID: "p1", Material: "herrajes", Status: "despachado"},
			{ProjectID: "p1", Material: "tableros", Status: "pendiente"},
		},
	}
	srv := &Server{Store: store}

	for _, role := range []domain.UserRole{domain.RoleAdmin, domain.RoleGerenteProduccion, domain.RoleAlmacen} {
		req := withClaims(httptest.NewRequest(http.MethodGet, "/api/picking", nil), "u1", string(role))
		rr := httptest.NewRecorder()
		srv.HandlePickingList(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("role %s: status %d want 200 (body=%s)", role, rr.Code, rr.Body.String())
		}
		var got []domain.ProjectPicking
		if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
			t.Fatalf("decoding: %v", err)
		}
		if len(got) != 2 || got[0].ProjectID != "p1" || got[0].Material != "herrajes" {
			t.Fatalf("role %s: %#v", role, got)
		}
	}
}

func TestPicking_ListDeniedToOtherRoles(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	for _, role := range []domain.UserRole{domain.RoleIngeniero, domain.RoleProduccion, domain.RoleVendedor, domain.RoleUser} {
		req := withClaims(httptest.NewRequest(http.MethodGet, "/api/picking", nil), "u1", string(role))
		rr := httptest.NewRecorder()
		srv.HandlePickingList(rr, req)
		if rr.Code != http.StatusForbidden {
			t.Fatalf("role %s: status %d want 403 (body=%s)", role, rr.Code, rr.Body.String())
		}
	}
}

func TestPicking_UpsertAdminStampsWhoWhen(t *testing.T) {
	store := &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "Cocina López", CustomerID: "c1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusAccepted,
		},
	}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"project_id":"p1","material":"herrajes","status":"despachado"}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/picking", body), "a1", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandlePickingUpsert(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status %d want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if len(store.pickingUpsertWrites) != 1 {
		t.Fatalf("expected one write, got %#v", store.pickingUpsertWrites)
	}
	got := store.pickingUpsertWrites[0]
	if got.ProjectID != "p1" || got.Material != "herrajes" || got.Status != "despachado" {
		t.Fatalf("write: %#v", got)
	}
	if got.MarkedAt == nil {
		t.Fatal("despacho must stamp marked_at")
	}
	if got.MarkedBy == nil || *got.MarkedBy != "a1" {
		t.Fatalf("despacho must stamp actor id, got %v", got.MarkedBy)
	}
}

func TestPicking_UpsertPendienteClearsStamp(t *testing.T) {
	store := &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "P", CustomerID: "c1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusAccepted,
		},
	}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"project_id":"p1","material":"tableros","status":"pendiente"}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/picking", body), "a1", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandlePickingUpsert(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status %d want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	got := store.pickingUpsertWrites[0]
	if got.Status != "pendiente" {
		t.Fatalf("status %q want pendiente", got.Status)
	}
	if got.MarkedAt != nil || got.MarkedBy != nil {
		t.Fatalf("pendiente must clear the stamp, got %#v", got)
	}
}

func TestPicking_UpsertGerenteReadOnlyDenied(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"project_id":"p1","material":"cintillas","status":"despachado"}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/picking", body), "g1", string(domain.RoleGerenteProduccion))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandlePickingUpsert(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d want 403 (body=%s)", rr.Code, rr.Body.String())
	}
	if len(store.pickingUpsertWrites) != 0 {
		t.Fatal("gerente_produccion must not write picking")
	}
}

func TestPicking_UpsertAlmacenAllowed(t *testing.T) {
	store := &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "P", CustomerID: "c1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusAccepted,
		},
	}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"project_id":"p1","material":"herrajes","status":"despachado"}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/picking", body), "w1", string(domain.RoleAlmacen))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandlePickingUpsert(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status %d want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if len(store.pickingUpsertWrites) != 1 {
		t.Fatal("almacen must be able to mark despachado")
	}
}

func TestPicking_UpsertRejectsInvalidInput(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	cases := []struct {
		name string
		body string
	}{
		{"bad material", `{"project_id":"p1","material":"tornillos","status":"despachado"}`},
		{"bad status", `{"project_id":"p1","material":"herrajes","status":"entregado"}`},
		{"missing project", `{"project_id":"","material":"herrajes","status":"despachado"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := withClaims(httptest.NewRequest(http.MethodPut, "/api/picking", strings.NewReader(tc.body)), "a1", string(domain.RoleAdmin))
			req.Header.Set("Content-Type", "application/json")
			rr := httptest.NewRecorder()
			srv.HandlePickingUpsert(rr, req)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status %d want 400 (body=%s)", rr.Code, rr.Body.String())
			}
			if len(store.pickingUpsertWrites) != 0 {
				t.Fatal("invalid input must not reach the store")
			}
		})
	}
}

func TestPicking_UpsertUnknownProject404(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"project_id":"p-nope","material":"herrajes","status":"despachado"}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/picking", body), "a1", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandlePickingUpsert(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status %d want 404 (body=%s)", rr.Code, rr.Body.String())
	}
	if len(store.pickingUpsertWrites) != 0 {
		t.Fatal("unknown project must not write")
	}
}

func TestRBAC_PickingDomainParity(t *testing.T) {
	if !domain.RoleCanAccessPurchasingNav(domain.RoleAdmin) {
		t.Fatal("admin opens purchasing nav")
	}
	if !domain.RoleCanAccessPurchasingNav(domain.RoleGerenteProduccion) {
		t.Fatal("gerente_produccion opens purchasing nav")
	}
	if !domain.RoleCanAccessPurchasingNav(domain.RoleAlmacen) {
		t.Fatal("almacen opens purchasing nav")
	}
	if domain.RoleCanAccessPurchasingNav(domain.RoleIngeniero) {
		t.Fatal("ingeniero stays out of purchasing")
	}
	if domain.RoleCanMarkPicking(domain.RoleGerenteProduccion) {
		t.Fatal("gerente_produccion reads picking but must not mark")
	}
	if !domain.RoleCanMarkPicking(domain.RoleAdmin) || !domain.RoleCanMarkPicking(domain.RoleAlmacen) {
		t.Fatal("admin/almacen mark despachos")
	}
}
