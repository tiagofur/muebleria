package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// --- HandleAmbientMaterials / HandleAmbientMaterialByID (#4150) ---
//
// Mirrors the materials handler test style (withClaims + stubStore, no DB).
// Role guard, list, create round-trip, duplicate-key, media cleanup on PUT,
// and NULL-vs-0 PBR preservation are all covered here.

func TestHandleAmbientMaterials_IngenieroCreateReturns201(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"a1","code":"FLR-OAK","name":"Roble","surface_type":"floor","active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/ambient-materials", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleAmbientMaterials(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusCreated, rr.Body.String())
	}
	if !store.createAmbientOK {
		t.Fatal("store must create ambient material for ingeniero")
	}
	var got domain.AmbientMaterial
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if got.Code != "FLR-OAK" || got.SurfaceType != domain.AmbientSurfaceFloor {
		t.Errorf("echoed create = %#v, want code FLR-OAK surface floor", got)
	}
	if !got.Active {
		t.Error("handler must force Active=true on create")
	}
}

func TestHandleAmbientMaterials_VendedorCreateReturns403(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"a1","code":"FLR","name":"X","surface_type":"floor","active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/ambient-materials", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleAmbientMaterials(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d want 403 body=%s", rr.Code, rr.Body.String())
	}
	if store.createAmbientOK {
		t.Fatal("store must not create ambient material for vendedor")
	}
}

func TestHandleAmbientMaterials_ListReturns200(t *testing.T) {
	store := &stubStore{
		listAmbientMaterials: []domain.AmbientMaterial{
			{ID: "a1", Code: "FLR", Name: "Floor", SurfaceType: domain.AmbientSurfaceFloor},
			{ID: "a2", Code: "WAL", Name: "Wall", SurfaceType: domain.AmbientSurfaceWall},
			{ID: "a3", Code: "FLR2", Name: "Floor 2", SurfaceType: domain.AmbientSurfaceFloor},
		},
	}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/ambient-materials", nil), "v1", string(domain.RoleVendedor))
	rr := httptest.NewRecorder()

	srv.HandleAmbientMaterials(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var got []domain.AmbientMaterial
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding list: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("list length = %d, want 3", len(got))
	}
}

func TestHandleAmbientMaterials_DuplicateKeyReturns409(t *testing.T) {
	srv := &Server{Store: &stubStore{createAmbientErr: dupErr("error creating ambient material")}}
	body := strings.NewReader(`{"id":"a1","code":"DUP","name":"Dup","surface_type":"floor","active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/ambient-materials", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleAmbientMaterials(rr, req)

	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusConflict, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "código") {
		t.Errorf("error message = %q, want it to mention 'código'", msg)
	}
}

func TestHandleAmbientMaterialByID_GetReturns200(t *testing.T) {
	store := &stubStore{
		ambientReturnedByID: &domain.AmbientMaterial{
			ID: "a1", Code: "FLR-OAK", Name: "Roble", Active: true,
			SurfaceType:       domain.AmbientSurfaceFloor,
			PreviewColor:      "#8b5a2b",
			PreviewTextureURL: "/api/media/oak.webp",
		},
	}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/ambient-materials/a1", nil), "v1", string(domain.RoleVendedor))
	req.SetPathValue("id", "a1")
	rr := httptest.NewRecorder()

	srv.HandleAmbientMaterialByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var got domain.AmbientMaterial
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if got.Code != "FLR-OAK" || got.PreviewTextureURL != "/api/media/oak.webp" {
		t.Errorf("get round-trip = %#v", got)
	}
}

func TestHandleAmbientMaterialByID_GetNotFoundReturns404(t *testing.T) {
	srv := &Server{Store: &stubStore{ambientGetByIDErr: errNotFound()}}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/ambient-materials/missing", nil), "eng", string(domain.RoleIngeniero))
	req.SetPathValue("id", "missing")
	rr := httptest.NewRecorder()

	srv.HandleAmbientMaterialByID(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusNotFound, rr.Body.String())
	}
}

func TestHandleAmbientMaterialByID_VendedorPutReturns403(t *testing.T) {
	srv := &Server{Store: &stubStore{ambientReturnedByID: &domain.AmbientMaterial{ID: "a1"}}}
	body := strings.NewReader(`{"code":"C","name":"N","surface_type":"floor","active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/ambient-materials/a1", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "a1")
	rr := httptest.NewRecorder()

	srv.HandleAmbientMaterialByID(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d want 403 body=%s", rr.Code, rr.Body.String())
	}
	if srv.Store.(*stubStore).updateAmbientCalled {
		t.Fatal("store must not update ambient material for vendedor")
	}
}

// PUT must clean up a replaced texture file (mirrors material boards PUT).
func TestHandleAmbientMaterialByID_UpdateCleansReplacedTexture(t *testing.T) {
	dir := t.TempDir()
	oldTex := writeMediaFile(t, dir, "oldtex.webp")

	store := &stubStore{
		ambientReturnedByID: &domain.AmbientMaterial{
			ID:                "a1",
			PreviewTextureURL: "/api/media/oldtex.webp",
		},
	}
	srv := &Server{Store: store, MediaDir: dir}
	body := strings.NewReader(`{"code":"C","name":"N","surface_type":"floor","active":true,"preview_texture_url":"/api/media/newtex.webp"}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/ambient-materials/a1", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "a1")
	rr := httptest.NewRecorder()

	srv.HandleAmbientMaterialByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if !store.updateAmbientCalled {
		t.Fatal("UpdateAmbientMaterial not called")
	}
	if fileExists(t, oldTex) {
		t.Error("old texture file should be deleted after URL changed")
	}
}

// PUT must NOT delete a texture file that is kept unchanged.
func TestHandleAmbientMaterialByID_UpdateKeepsSameTexture(t *testing.T) {
	dir := t.TempDir()
	tex := writeMediaFile(t, dir, "keep.webp")

	store := &stubStore{
		ambientReturnedByID: &domain.AmbientMaterial{
			ID:                "a1",
			PreviewTextureURL: "/api/media/keep.webp",
		},
	}
	srv := &Server{Store: store, MediaDir: dir}
	body := strings.NewReader(`{"code":"C","name":"N","surface_type":"floor","active":true,"preview_texture_url":"/api/media/keep.webp"}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/ambient-materials/a1", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "a1")
	rr := httptest.NewRecorder()

	srv.HandleAmbientMaterialByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if !fileExists(t, tex) {
		t.Error("unchanged texture file must not be deleted")
	}
}

// PUT must preserve preview_roughness:0 distinct from omitted (NULL-vs-0 guard,
// the core nullable-PBR requirement from spec #4150 / design #4151).
func TestHandleAmbientMaterialByID_UpdatePreservesZeroRoughness(t *testing.T) {
	store := &stubStore{ambientReturnedByID: &domain.AmbientMaterial{ID: "a1"}}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"code":"C","name":"N","surface_type":"floor","active":true,"preview_roughness":0}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/ambient-materials/a1", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "a1")
	rr := httptest.NewRecorder()

	srv.HandleAmbientMaterialByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	got := store.updateAmbientReceived
	if got == nil || got.PreviewRoughness == nil {
		t.Fatalf("preview_roughness=0 must decode to a non-nil pointer, got %#v", got)
	}
	if *got.PreviewRoughness != 0 {
		t.Errorf("preview_roughness = %v, want 0", *got.PreviewRoughness)
	}
}

// PUT must decode an omitted PBR field to a nil pointer (undefined, not 0).
func TestHandleAmbientMaterialByID_UpdateOmittedPBRIsNil(t *testing.T) {
	store := &stubStore{ambientReturnedByID: &domain.AmbientMaterial{ID: "a1"}}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"code":"C","name":"N","surface_type":"floor","active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/ambient-materials/a1", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "a1")
	rr := httptest.NewRecorder()

	srv.HandleAmbientMaterialByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	got := store.updateAmbientReceived
	if got == nil {
		t.Fatal("expected update payload")
	}
	if got.PreviewRoughness != nil {
		t.Errorf("omitted preview_roughness must be nil, got %v", *got.PreviewRoughness)
	}
}

func TestHandleAmbientMaterialByID_DeleteDeactivates(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodDelete, "/api/catalog/ambient-materials/a1", nil), "eng", string(domain.RoleIngeniero))
	req.SetPathValue("id", "a1")
	rr := httptest.NewRecorder()

	srv.HandleAmbientMaterialByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if !store.deactivateAmbientCalled || store.deactivateAmbientReceived != "a1" {
		t.Fatalf("DeactivateAmbientMaterial not called with a1 (called=%v id=%q)", store.deactivateAmbientCalled, store.deactivateAmbientReceived)
	}
}

// --- AMBIENT CATEGORIES TESTS (F086) ---

func TestHandleAmbientCategories_ListReturns200(t *testing.T) {
	store := &stubStore{
		listAmbientCategories: []domain.AmbientCategory{
			{ID: "c1", Name: "Maderas", SortOrder: 0},
			{ID: "c2", Name: "Metales", SortOrder: 1},
		},
	}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/ambient-categories", nil), "v1", string(domain.RoleVendedor))
	rr := httptest.NewRecorder()

	srv.HandleAmbientCategories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var got []domain.AmbientCategory
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding list: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("list length = %d, want 2", len(got))
	}
}

func TestHandleAmbientCategories_IngenieroCreateReturns201(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"c1","name":"Maderas","sort_order":0}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/ambient-categories", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleAmbientCategories(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusCreated, rr.Body.String())
	}
	if !store.createAmbientCategoryOK {
		t.Fatal("store must create ambient category for ingeniero")
	}
}

func TestHandleAmbientCategories_VendedorCreateReturns403(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"c1","name":"Maderas"}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/ambient-categories", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleAmbientCategories(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d want 403 body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleAmbientCategoryByID_GetReturns200(t *testing.T) {
	store := &stubStore{
		ambientCategoryReturnedByID: &domain.AmbientCategory{
			ID:   "c1",
			Name: "Maderas",
		},
	}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/ambient-categories/c1", nil), "v1", string(domain.RoleVendedor))
	req.SetPathValue("id", "c1")
	rr := httptest.NewRecorder()

	srv.HandleAmbientCategoryByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestHandleAmbientCategoryByID_UpdateAndDeletes(t *testing.T) {
	store := &stubStore{
		ambientCategoryReturnedByID: &domain.AmbientCategory{ID: "c1", Name: "Maderas"},
	}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"name":"Maderas Nobles"}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/ambient-categories/c1", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "c1")
	rr := httptest.NewRecorder()

	srv.HandleAmbientCategoryByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if !store.updateAmbientCategoryCalled {
		t.Fatal("UpdateAmbientCategory must be called")
	}

	// Delete
	delReq := withClaims(httptest.NewRequest(http.MethodDelete, "/api/catalog/ambient-categories/c1", nil), "eng", string(domain.RoleIngeniero))
	delReq.SetPathValue("id", "c1")
	delRR := httptest.NewRecorder()

	srv.HandleAmbientCategoryByID(delRR, delReq)

	if delRR.Code != http.StatusOK {
		t.Fatalf("delete status = %d, want 200", delRR.Code)
	}
	if !store.deleteAmbientCategoryCalled {
		t.Fatal("DeleteAmbientCategory must be called")
	}
}

// errNotFound mimics the storage-layer "not found" error the handler maps to 404.
func errNotFound() error { return errors.New("ambient material not found") }
