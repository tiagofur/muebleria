package api

import (
	"encoding/json"
	"errors"
	httptest "net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// F142: material categories (subgrupos de tableros) — mirrors the ambient
// categories handler tests: role guard, list, placement 400, delete 409.

func TestHandleMaterialCategories_ListReturns200(t *testing.T) {
	store := &stubStore{
		listMaterialCategories: []domain.MaterialCategory{
			{ID: "mc1", Name: "Melamina"},
			{ID: "mc2", Name: "Blancos", ParentID: "mc1"},
		},
	}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest("GET", "/api/catalog/material-categories", nil), "v1", string(domain.RoleVendedor))
	rr := httptest.NewRecorder()

	srv.HandleMaterialCategories(rr, req)

	if rr.Code != 200 {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var got []domain.MaterialCategory
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding list: %v", err)
	}
	if len(got) != 2 || got[1].ParentID != "mc1" {
		t.Fatalf("list = %#v, want 2 with parent link", got)
	}
}

func TestHandleMaterialCategories_IngenieroCreateReturns201(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"mc1","name":"Melamina","sort_order":1}`)
	req := withClaims(httptest.NewRequest("POST", "/api/catalog/material-categories", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleMaterialCategories(rr, req)

	if rr.Code != 201 {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if !store.createMaterialCategoryOK {
		t.Fatal("store must create material category for ingeniero")
	}
}

func TestHandleMaterialCategories_VendedorCreateReturns403(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"mc1","name":"Melamina"}`)
	req := withClaims(httptest.NewRequest("POST", "/api/catalog/material-categories", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleMaterialCategories(rr, req)

	if rr.Code != 403 {
		t.Fatalf("status %d want 403 body=%s", rr.Code, rr.Body.String())
	}
	if store.createMaterialCategoryOK {
		t.Fatal("store must not create material category for vendedor")
	}
}

func TestHandleMaterialCategories_CreatePlacementErrorReturns400(t *testing.T) {
	store := &stubStore{createMaterialCategoryErr: errors.New("invalid category placement: categories cannot exceed 3 levels")}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"mc9","name":"Nivel 4","parent_id":"mc8"}`)
	req := withClaims(httptest.NewRequest("POST", "/api/catalog/material-categories", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleMaterialCategories(rr, req)

	if rr.Code != 400 {
		t.Fatalf("status %d want 400 body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleMaterialCategoryByID_DeleteChildrenReturns409(t *testing.T) {
	store := &stubStore{deleteMaterialCategoryErrHook: errors.New("cannot delete category with children; reparent or delete children first")}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest("DELETE", "/api/catalog/material-categories/mc1", nil), "eng", string(domain.RoleIngeniero))
	req.SetPathValue("id", "mc1")
	rr := httptest.NewRecorder()

	srv.HandleMaterialCategoryByID(rr, req)

	if rr.Code != 409 {
		t.Fatalf("status %d want 409 body=%s", rr.Code, rr.Body.String())
	}
}

// F142: manufacturer is required on material writes.

func TestHandleMaterials_PostWithoutManufacturerReturns400(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"m1","code":"TAB-X","name":"Sin Fabricante","width_mm":1830,"length_mm":2440,"thickness_mm":18,"board_price":100,"waste_percent":0,"active":true}`)
	req := withClaims(httptest.NewRequest("POST", "/api/catalog/materials", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleMaterials(rr, req)

	if rr.Code != 400 {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.createMaterialOK {
		t.Fatal("store must not create a material without manufacturer")
	}
}

// F142: PUT sin fabricante conserva el existente — los syncs de catálogos
// legacy (pre-fabricante obligatorio) no deben romper la sincronización.
func TestHandleMaterials_PutWithoutManufacturerKeepsExisting(t *testing.T) {
	store := &stubStore{
		materialReturnedByID: &domain.MaterialBoard{ID: "m1", Code: "TAB-X", Manufacturer: "Arauco"},
	}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"m1","code":"TAB-X","name":"Sync legacy","width_mm":1830,"length_mm":2440,"thickness_mm":18,"board_price":100,"waste_percent":0,"active":true}`)
	req := withClaims(httptest.NewRequest("PUT", "/api/catalog/materials/m1", body), "eng", string(domain.RoleIngeniero))
	req.SetPathValue("id", "m1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleMaterialByID(rr, req)

	if rr.Code != 200 {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if got := store.updateMaterialReceived.Manufacturer; got != "Arauco" {
		t.Fatalf("manufacturer = %q, want inherited %q", got, "Arauco")
	}
}
