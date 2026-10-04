package api

import (
	"github.com/tiagofur/muebles-backend/internal/domain"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Contrato: tests de biblioteca paramétrica — media de módulos y
// validación de roles de componentes (F050).
func TestHandleModuleByIDUpdateCleansReplacedImage(t *testing.T) {
	dir := t.TempDir()
	oldImg := writeMediaFile(t, dir, "mod-old.webp")

	store := &stubStore{
		moduleReturnedByID: &domain.Module{
			ID:       "mod1",
			ImageURL: "/api/media/mod-old.webp",
		},
	}
	srv := &Server{Store: store, MediaDir: dir}

	body := strings.NewReader(`{"code":"MC","name":"N","base_labor_cost":0,"width_mm":100,"height_mm":100,"depth_mm":100,"image_url":"/api/media/mod-new.webp"}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/modules/mod1", body), "eng", string(domain.RoleIngeniero))
	req.SetPathValue("id", "mod1")
	req.Header.Set("If-Match", `"v1"`)
	rr := httptest.NewRecorder()
	srv.HandleModuleByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if fileExists(t, oldImg) {
		t.Error("old module image should be deleted after URL changed")
	}
}

// Physical delete of a module must also remove the image file.
func TestHandleModuleByIDDeleteRemovesImage(t *testing.T) {
	dir := t.TempDir()
	imgPath := writeMediaFile(t, dir, "mod-del.jpg")

	store := &stubStore{
		moduleReturnedByID: &domain.Module{
			ID:       "mod1",
			ImageURL: "/api/media/mod-del.jpg",
		},
	}
	srv := &Server{Store: store, MediaDir: dir}

	req := withClaims(httptest.NewRequest(http.MethodDelete, "/api/catalog/modules/mod1", nil), "eng", string(domain.RoleIngeniero))
	req.SetPathValue("id", "mod1")
	rr := httptest.NewRecorder()
	srv.HandleModuleByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if !store.deleteModuleCalled || store.deleteModuleReceivedID != "mod1" {
		t.Errorf("DeleteModule not called correctly: called=%v id=%q", store.deleteModuleCalled, store.deleteModuleReceivedID)
	}
	if fileExists(t, imgPath) {
		t.Error("module image should be deleted after physical delete")
	}
}

// Soft delete (DeactivateMaterialBoard) must NOT touch the file: the row may
// be reactivated later and the image should still be there.
func TestHandleComponentsAmbiguousRolesRejected400(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	body := strings.NewReader(`{"code":"AMB","name":"Ambigua","placement":"puerta","geometry_kind":"rectangular_board","thickness_mm":18,"option_roles":["FRONT","BODY"],"active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/components", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleComponents(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusBadRequest, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "una única selección") {
		t.Errorf("error message = %q, want the single-binding contract hint", msg)
	}
}

func TestHandleComponentsEmptyRolesRejected400(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	body := strings.NewReader(`{"code":"VAC","name":"Vacía","placement":"puerta","geometry_kind":"rectangular_board","thickness_mm":18,"option_roles":["","  "],"active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/components", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleComponents(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusBadRequest, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "al menos un rol") {
		t.Errorf("error message = %q, want the empty-roles hint", msg)
	}
}
