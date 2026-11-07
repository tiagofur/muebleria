package api

import (
	"encoding/json"
	"errors"
	"net/http"
	httptest "net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1507: hardware categories (subgrupos de herrajes) — mirrors the material
// categories handler tests: role guard, list, create 201, placement 400.

func TestHandleHardwareCategories_ListReturns200(t *testing.T) {
	store := &stubStore{
		listHardwareCategories: []domain.HardwareCategory{
			{ID: "hc1", Name: "Bisagras"},
			{ID: "hc2", Name: "Correderas"},
		},
	}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest("GET", "/api/catalog/hardware-categories", nil), "v1", string(domain.RoleVendedor))
	rr := httptest.NewRecorder()

	srv.HandleHardwareCategories(rr, req)

	if rr.Code != 200 {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var got []domain.HardwareCategory
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding list: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("list = %#v, want 2 nodes", got)
	}
}

func TestHandleHardwareCategories_IngenieroCreateReturns201(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"hc1","name":"Bisagras","sort_order":1}`)
	req := withClaims(httptest.NewRequest("POST", "/api/catalog/hardware-categories", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleHardwareCategories(rr, req)

	if rr.Code != 201 {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if !store.createHardwareCategoryOK {
		t.Fatal("store must create hardware category for ingeniero")
	}
}

func TestHandleHardwareCategories_VendedorCreateReturns403(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"hc1","name":"Bisagras"}`)
	req := withClaims(httptest.NewRequest("POST", "/api/catalog/hardware-categories", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleHardwareCategories(rr, req)

	if rr.Code != 403 {
		t.Fatalf("status %d want 403 body=%s", rr.Code, rr.Body.String())
	}
	if store.createHardwareCategoryOK {
		t.Fatal("store must not create hardware category for vendedor")
	}
}

func TestHandleHardwareCategories_CreatePlacementErrorReturns400(t *testing.T) {
	store := &stubStore{createHardwareCategoryErr: errors.New("invalid category placement: categories cannot exceed 3 levels")}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"hc9","name":"Nivel 4","parent_id":"hc8"}`)
	req := withClaims(httptest.NewRequest("POST", "/api/catalog/hardware-categories", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleHardwareCategories(rr, req)

	if rr.Code != 400 {
		t.Fatalf("status %d want 400 body=%s", rr.Code, rr.Body.String())
	}
}

// #1556: the typed errors reach the wire. The stub flags the issue names
// unused (update/delete) now drive these paths.

func TestHandleHardwareCategories_PutNotFoundMapsTyped404(t *testing.T) {
	store := &stubStore{updateHardwareCategoryErr: storage.ErrHardwareCategoryNotFound}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/hardware-categories/hc-x", strings.NewReader(`{"name":"X"}`)), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "hc-x")
	req.Header.Set("If-Match", `"v1"`)
	rr := httptest.NewRecorder()

	srv.HandleHardwareCategoryByID(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body=%s)", rr.Code, rr.Body.String())
	}
	if !store.updateHardwareCategoryCalled {
		t.Fatal("the update must reach the store")
	}
}

func TestHandleHardwareCategories_PutInternalFailureIsNeverA404(t *testing.T) {
	store := &stubStore{updateHardwareCategoryErr: errors.New("connection reset by peer")}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/hardware-categories/hc-x", strings.NewReader(`{"name":"X"}`)), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "hc-x")
	req.Header.Set("If-Match", `"v1"`)
	rr := httptest.NewRecorder()

	srv.HandleHardwareCategoryByID(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (a dropped connection is not a 404)", rr.Code)
	}
}

func TestHandleHardwareCategories_PutVersionConflict412(t *testing.T) {
	store := &stubStore{updateHardwareCategoryErr: storage.ErrVersionConflict}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/hardware-categories/hc-x", strings.NewReader(`{"name":"X"}`)), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "hc-x")
	req.Header.Set("If-Match", `"v1"`)
	rr := httptest.NewRecorder()

	srv.HandleHardwareCategoryByID(rr, req)

	if rr.Code != http.StatusPreconditionFailed {
		t.Fatalf("status = %d, want 412", rr.Code)
	}
}

func TestHandleHardwareCategories_DeleteWithChildren409(t *testing.T) {
	store := &stubStore{deleteHardwareCategoryErr: storage.ErrHardwareCategoryHasChildren}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodDelete, "/api/catalog/hardware-categories/hc-x", nil), "eng", string(domain.RoleIngeniero))
	req.SetPathValue("id", "hc-x")
	req.Header.Set("If-Match", `"v1"`)
	rr := httptest.NewRecorder()

	srv.HandleHardwareCategoryByID(rr, req)

	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 (body=%s)", rr.Code, rr.Body.String())
	}
	if !store.deleteHardwareCategoryCalled {
		t.Fatal("the delete must reach the store")
	}
}

func TestHandleHardwareCategories_DeleteNotFound404(t *testing.T) {
	store := &stubStore{deleteHardwareCategoryErr: storage.ErrHardwareCategoryNotFound}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodDelete, "/api/catalog/hardware-categories/hc-x", nil), "eng", string(domain.RoleIngeniero))
	req.SetPathValue("id", "hc-x")
	req.Header.Set("If-Match", `"v1"`)
	rr := httptest.NewRecorder()

	srv.HandleHardwareCategoryByID(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
}

func TestHandleHardwareCategoryByID_GetInternalFailureIsNeverA404(t *testing.T) {
	store := &stubStore{hardwareCategoryGetByIDErr: errors.New("connection reset by peer")}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/hardware-categories/hc-x", nil), "v1", string(domain.RoleVendedor))
	req.SetPathValue("id", "hc-x")
	rr := httptest.NewRecorder()

	srv.HandleHardwareCategoryByID(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rr.Code)
	}
}
