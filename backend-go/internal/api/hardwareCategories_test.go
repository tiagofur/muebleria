package api

import (
	"encoding/json"
	"errors"
	httptest "net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
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
