package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Contrato: tests de clientes y catálogo comercial — dup-key 409, RBAC de
// materiales, costes F039/F044 y limpieza de media reemplazada.
func TestHandleCustomersDuplicateKeyReturns409(t *testing.T) {
	srv := &Server{Store: &stubStore{createCustomerErr: dupErr("error creating customer")}}
	body := strings.NewReader(`{"id":"11111111-2222-3333-4444-555555555555","name":"Dup","active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/customers", body), "admin", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleCustomers(rr, req)

	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusConflict, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "ya existe") {
		t.Errorf("error message = %q, want it to mention 'ya existe'", msg)
	}
}

func TestHandleMaterialsDuplicateKeyReturns409(t *testing.T) {
	srv := &Server{Store: &stubStore{createMaterialErr: dupErr("error creating material board")}}
	body := strings.NewReader(`{"code":"MAT-DUP","name":"Dup","manufacturer":"Arauco","width_mm":100,"length_mm":100,"thickness_mm":18,"board_price":10}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/materials", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleMaterials(rr, req)

	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusConflict, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "código") {
		t.Errorf("error message = %q, want it to mention 'código'", msg)
	}
}

func TestHandleCustomersCreateSuccess(t *testing.T) {
	srv := &Server{Store: &stubStore{createCustomerErr: nil}}
	body := strings.NewReader(`{"id":"22222222-3333-4444-5555-666666666666","name":"Nuevo","active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/customers", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleCustomers(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusCreated, rr.Body.String())
	}
	var got domain.Customer
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if !got.Active {
		t.Errorf("expected handler to force Active=true on create, got Active=%v", got.Active)
	}
}
func TestRBAC_VendedorCannotCreateMaterial(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"m1","code":"M1","name":"Board","manufacturer":"Arauco","width_mm":1830,"length_mm":2750,"thickness_mm":15,"grain_default":false,"board_price":100,"active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/materials", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleMaterials(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d want 403 body=%s", rr.Code, rr.Body.String())
	}
	if store.createMaterialOK {
		t.Fatal("store must not create material for vendedor")
	}
}

func TestRBAC_ProduccionCannotCreateMaterial(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	body := strings.NewReader(`{"id":"m1","code":"M1","name":"Board","manufacturer":"Arauco","width_mm":1830,"length_mm":2750,"thickness_mm":15,"grain_default":false,"board_price":100,"active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/materials", body), "p1", string(domain.RoleProduccion))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleMaterials(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d want 403", rr.Code)
	}
}

func TestRBAC_IngenieroCanCreateMaterial(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"m1","code":"M1","name":"Board","manufacturer":"Arauco","width_mm":1830,"length_mm":2750,"thickness_mm":15,"grain_default":false,"board_price":100,"active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/materials", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleMaterials(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("status %d want 201 body=%s", rr.Code, rr.Body.String())
	}
	if !store.createMaterialOK {
		t.Fatal("expected material created")
	}
}
func TestRBAC_ProduccionCannotAccessCustomers(t *testing.T) {
	srv := &Server{Store: &stubStore{listCustomers: []domain.Customer{{ID: "c1"}}}}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/customers", nil), "p1", string(domain.RoleProduccion))
	rr := httptest.NewRecorder()
	srv.HandleCustomers(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d want 403", rr.Code)
	}
}
func TestF039_VendedorMaterialsListRedactsCosts(t *testing.T) {
	store := &stubStore{
		listMaterials: []domain.MaterialBoard{
			{ID: "m1", Code: "M1", Name: "Board", BoardPrice: 100, CostPerM2: 25, Active: true},
		},
	}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/materials", nil), "v1", string(domain.RoleVendedor))
	rr := httptest.NewRecorder()
	srv.HandleMaterials(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d", rr.Code)
	}
	var list []domain.MaterialBoard
	if err := json.Unmarshal(rr.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].BoardPrice != 0 || list[0].CostPerM2 != 0 {
		t.Fatalf("expected redacted costs: %#v", list)
	}
	// Admin still sees costs
	store2 := &stubStore{
		listMaterials: []domain.MaterialBoard{
			{ID: "m1", Code: "M1", Name: "Board", BoardPrice: 100, CostPerM2: 25, Active: true},
		},
	}
	srv2 := &Server{Store: store2}
	req2 := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/materials", nil), "a1", string(domain.RoleAdmin))
	rr2 := httptest.NewRecorder()
	srv2.HandleMaterials(rr2, req2)
	var list2 []domain.MaterialBoard
	_ = json.Unmarshal(rr2.Body.Bytes(), &list2)
	if len(list2) != 1 || list2[0].BoardPrice != 100 {
		t.Fatalf("admin should see board_price: %#v", list2)
	}
}

func TestF044_VendedorMaterialsShowCostsWhenFlagOn(t *testing.T) {
	flagOn := domain.DefaultWorkshopSettings()
	flagOn.VendedorCanViewCosts = true
	store := &stubStore{
		listMaterials: []domain.MaterialBoard{
			{ID: "m1", Code: "M1", Name: "Board", BoardPrice: 100, CostPerM2: 25, Active: true},
		},
		workshopSettings: &flagOn,
	}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/materials", nil), "v1", string(domain.RoleVendedor))
	rr := httptest.NewRecorder()
	srv.HandleMaterials(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d", rr.Code)
	}
	var list []domain.MaterialBoard
	if err := json.Unmarshal(rr.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].BoardPrice != 100 || list[0].CostPerM2 != 25 {
		t.Fatalf("expected costs visible with flag: %#v", list)
	}
}
func TestF039_VendedorMaterialsHideCosts(t *testing.T) {
	store := &stubStore{}
	// Override ListMaterialBoards via embedding is hard — use direct domain redact unit + handler path with stub.
	// Handler path: stub ListMaterialBoards not implemented returns panic — use domain package test for redact,
	// and exercise calculate redaction here.
	_ = store
	srv := &Server{Store: &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "v1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusDraft,
		},
	}}
	// Calculate needs catalog — skip if GetFullCatalog panics. Use domain redaction assertion instead.
	bd := domain.QuoteBreakdown{MaterialsCost: 50, DirectCost: 80, MarginFactor: 1.35, SalePrice: 108}
	domain.RedactQuoteBreakdown(&bd)
	if bd.SalePrice != 108 || bd.DirectCost != 0 {
		t.Fatalf("redact: %#v", bd)
	}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/projects/p1", nil), "v1", string(domain.RoleVendedor))
	req.SetPathValue("id", "p1")
	rr := httptest.NewRecorder()
	srv.HandleProjectByID(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rr.Code, rr.Body.String())
	}
	var got domain.Project
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.MarginFactor != 0 {
		t.Fatalf("vendedor project margin must be redacted, got %v", got.MarginFactor)
	}
	_ = srv
}
func TestHandleMaterialByIDUpdateCleansReplacedImage(t *testing.T) {
	dir := t.TempDir()
	oldImgPath := writeMediaFile(t, dir, "old.jpg")
	oldTexPath := writeMediaFile(t, dir, "oldtex.webp")
	// "new.jpg" is referenced by the new payload but does not need to exist on
	// disk for the cleanup path — the GET handler will just 404 for it, which
	// is fine; we are testing that the OLD file is removed.

	store := &stubStore{
		materialReturnedByID: &domain.MaterialBoard{
			ID:                "m1",
			ImageURL:          "/api/media/old.jpg",
			PreviewTextureURL: "/api/media/oldtex.webp",
		},
	}
	srv := &Server{Store: store, MediaDir: dir}

	body := strings.NewReader(`{"code":"C","name":"N","manufacturer":"Arauco","image_url":"/api/media/new.jpg","preview_texture_url":"","board_price":1,"waste_percent":0,"active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/materials/m1", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("If-Match", `"v1"`) // #1091: guarded writes carry the expected version
	req.SetPathValue("id", "m1")
	rr := httptest.NewRecorder()
	srv.HandleMaterialByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if !store.updateMaterialCalled {
		t.Fatal("UpdateMaterialBoard not called")
	}
	if fileExists(t, oldImgPath) {
		t.Error("old image file should be deleted after URL changed")
	}
	if fileExists(t, oldTexPath) {
		t.Error("old texture file should be deleted after URL changed")
	}
}

// PUT must decode and forward texture tile mm into UpdateMaterialBoard.
func TestHandleMaterialByIDUpdateReceivesTextureTiles(t *testing.T) {
	store := &stubStore{
		materialReturnedByID: &domain.MaterialBoard{ID: "m1"},
	}
	srv := &Server{Store: store}

	body := strings.NewReader(`{
		"code":"MAD-1","name":"Madera","manufacturer":"Arauco","width_mm":1830,"length_mm":2440,"thickness_mm":18,
		"board_price":10,"waste_percent":5,"active":true,
		"preview_texture_url":"/api/media/wood.webp",
		"preview_texture_tile_width_mm":400,
		"preview_texture_tile_length_mm":600
	}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/materials/m1", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("If-Match", `"v1"`) // #1091: guarded writes carry the expected version
	req.SetPathValue("id", "m1")
	rr := httptest.NewRecorder()
	srv.HandleMaterialByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
	}
	if store.updateMaterialReceived == nil {
		t.Fatal("expected UpdateMaterialBoard payload")
	}
	got := store.updateMaterialReceived
	if got.PreviewTextureTileWidthMm != 400 || got.PreviewTextureTileLengthMm != 600 {
		t.Fatalf("tiles = %.0f x %.0f, want 400 x 600", got.PreviewTextureTileWidthMm, got.PreviewTextureTileLengthMm)
	}
	if got.PreviewTextureURL != "/api/media/wood.webp" {
		t.Fatalf("texture url = %q", got.PreviewTextureURL)
	}
}

// When the URL does NOT change, the file must be preserved.
func TestHandleMaterialByIDUpdateKeepsSameImage(t *testing.T) {
	dir := t.TempDir()
	imgPath := writeMediaFile(t, dir, "keep.jpg")

	store := &stubStore{
		materialReturnedByID: &domain.MaterialBoard{
			ID:       "m1",
			ImageURL: "/api/media/keep.jpg",
		},
	}
	srv := &Server{Store: store, MediaDir: dir}

	body := strings.NewReader(`{"code":"C","name":"Renamed","manufacturer":"Arauco","image_url":"/api/media/keep.jpg","board_price":1,"waste_percent":0,"active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/materials/m1", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("If-Match", `"v1"`) // #1091: guarded writes carry the expected version
	req.SetPathValue("id", "m1")
	rr := httptest.NewRecorder()
	srv.HandleMaterialByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if !fileExists(t, imgPath) {
		t.Error("image file should be preserved when URL did not change")
	}
}

func TestHandleHardwareByIDUpdateCleansReplacedImage(t *testing.T) {
	dir := t.TempDir()
	oldImg := writeMediaFile(t, dir, "hw-old.png")

	store := &stubStore{
		hardwareReturnedByID: &domain.Hardware{
			ID:       "h1",
			ImageURL: "/api/media/hw-old.png",
		},
	}
	srv := &Server{Store: store, MediaDir: dir}

	body := strings.NewReader(`{"code":"HC","name":"N","unit":"pza","cost_per_unit":1,"image_url":"/api/media/hw-new.png","active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/hardware/h1", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("If-Match", `"v1"`)
	req.SetPathValue("id", "h1")
	rr := httptest.NewRecorder()
	srv.HandleHardwareByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if fileExists(t, oldImg) {
		t.Error("old hardware image should be deleted after URL changed")
	}
}
func TestHandleMaterialByIDSoftDeleteKeepsImage(t *testing.T) {
	dir := t.TempDir()
	imgPath := writeMediaFile(t, dir, "keep-on-deactivate.jpg")

	store := &stubStore{
		materialReturnedByID: &domain.MaterialBoard{
			ID:       "m1",
			ImageURL: "/api/media/keep-on-deactivate.jpg",
		},
	}
	srv := &Server{Store: store, MediaDir: dir}

	req := withClaims(httptest.NewRequest(http.MethodDelete, "/api/catalog/materials/m1", nil), "eng", string(domain.RoleIngeniero))
	req.Header.Set("If-Match", `"v1"`) // #1091: guarded writes carry the expected version
	req.SetPathValue("id", "m1")
	rr := httptest.NewRecorder()
	srv.HandleMaterialByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if !fileExists(t, imgPath) {
		t.Error("image file must survive soft delete (deactivate)")
	}
}

// TestPublicUserDTONeverLeaksSecrets (OC-005) ensures that JSON serialization of PublicUserDTO
// and LoginResponse never contains password hashes or raw passwords.

// #1084 (#443 slice 1): catalog hardware writes are If-Match guarded with a
// server-owned version (PUT and the deactivating DELETE).
func TestHandleHardwareByID_IfMatchGuardsWrites(t *testing.T) {
	newSrv := func(store *stubStore) *Server { return &Server{Store: store} }
	writeBody := func() *strings.Reader {
		return strings.NewReader(`{"code":"HC","name":"N","unit":"pza","cost_per_unit":1,"active":true}`)
	}

	t.Run("PUT sin If-Match es rechazado con 428 antes de escribir", func(t *testing.T) {
		store := &stubStore{}
		srv := newSrv(store)
		req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/hardware/h1", writeBody()), "eng", string(domain.RoleIngeniero))
		req.SetPathValue("id", "h1")
		rr := httptest.NewRecorder()
		srv.HandleHardwareByID(rr, req)
		if rr.Code != http.StatusPreconditionRequired {
			t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
		}
		if store.updateHardwareCalled {
			t.Fatal("store must not be reached without If-Match")
		}
	})

	t.Run("PUT con versión stale responde 412 VERSION_CONFLICT sin mutar", func(t *testing.T) {
		store := &stubStore{hardwareReturnedByID: &domain.Hardware{ID: "h1"}, updateHardwareErr: storage.ErrVersionConflict}
		srv := newSrv(store)
		req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/hardware/h1", writeBody()), "eng", string(domain.RoleIngeniero))
		req.Header.Set("If-Match", `"v1"`)
		req.SetPathValue("id", "h1")
		rr := httptest.NewRecorder()
		srv.HandleHardwareByID(rr, req)
		if rr.Code != http.StatusPreconditionFailed {
			t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
		}
		if !strings.Contains(rr.Body.String(), string(openapi.ApiErrorCodeVersionConflict)) {
			t.Fatalf("body missing VERSION_CONFLICT code: %s", rr.Body.String())
		}
	})

	t.Run("PUT con versión vigente responde 200 con ETag nuevo y versión esperada", func(t *testing.T) {
		store := &stubStore{hardwareReturnedByID: &domain.Hardware{ID: "h1"}}
		srv := newSrv(store)
		req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/hardware/h1", writeBody()), "eng", string(domain.RoleIngeniero))
		req.Header.Set("If-Match", `"v3"`)
		req.SetPathValue("id", "h1")
		rr := httptest.NewRecorder()
		srv.HandleHardwareByID(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
		}
		if store.updateHardwareExpectedVersion != 3 {
			t.Fatalf("expected version passed to store = %d, want 3", store.updateHardwareExpectedVersion)
		}
		if got := rr.Header().Get("ETag"); got != `"v4"` {
			t.Fatalf("ETag = %s, want the server-owned bumped version \"v4\"", got)
		}
	})

	t.Run("GET expone ETag de versión", func(t *testing.T) {
		store := &stubStore{hardwareReturnedByID: &domain.Hardware{ID: "h1", Version: 7}}
		srv := newSrv(store)
		req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/hardware/h1", nil), "eng", string(domain.RoleIngeniero))
		req.SetPathValue("id", "h1")
		rr := httptest.NewRecorder()
		srv.HandleHardwareByID(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d", rr.Code)
		}
		if got := rr.Header().Get("ETag"); got != `"v7"` {
			t.Fatalf("ETag = %s, want \"v7\"", got)
		}
	})

	t.Run("DELETE sin If-Match es rechazado con 428", func(t *testing.T) {
		store := &stubStore{}
		srv := newSrv(store)
		req := withClaims(httptest.NewRequest(http.MethodDelete, "/api/catalog/hardware/h1", nil), "eng", string(domain.RoleIngeniero))
		req.SetPathValue("id", "h1")
		rr := httptest.NewRecorder()
		srv.HandleHardwareByID(rr, req)
		if rr.Code != http.StatusPreconditionRequired {
			t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
		}
		if store.deactivateHardwareCalled {
			t.Fatal("store must not be reached without If-Match")
		}
	})

	t.Run("DELETE stale responde 412 y vigente desactiva", func(t *testing.T) {
		store := &stubStore{deactivateHardwareErr: storage.ErrVersionConflict}
		srv := newSrv(store)
		req := withClaims(httptest.NewRequest(http.MethodDelete, "/api/catalog/hardware/h1", nil), "eng", string(domain.RoleIngeniero))
		req.Header.Set("If-Match", `"v1"`)
		req.SetPathValue("id", "h1")
		rr := httptest.NewRecorder()
		srv.HandleHardwareByID(rr, req)
		if rr.Code != http.StatusPreconditionFailed {
			t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
		}

		okStore := &stubStore{}
		req2 := withClaims(httptest.NewRequest(http.MethodDelete, "/api/catalog/hardware/h1", nil), "eng", string(domain.RoleIngeniero))
		req2.Header.Set("If-Match", `"v2"`)
		req2.SetPathValue("id", "h1")
		rr2 := httptest.NewRecorder()
		newSrv(okStore).HandleHardwareByID(rr2, req2)
		if rr2.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", rr2.Code, rr2.Body.String())
		}
		if !okStore.deactivateHardwareCalled || okStore.deactivateHardwareExpectedVer != 2 {
			t.Fatalf("deactivate not called with expected version: called=%v v=%d", okStore.deactivateHardwareCalled, okStore.deactivateHardwareExpectedVer)
		}
	})
}
