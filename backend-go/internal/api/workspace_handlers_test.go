package api

import (
	"encoding/json"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Contrato: tests de utilidades operativas — acceso a settings (F044) y
// plantillas de proyecto (#110).
func TestF044_SettingsPutRequiresAccess(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	body := strings.NewReader(`{"default_margin_factor":1.4,"default_labor_fixed_cost":0,"default_currency":"MXN","vendedor_can_view_costs":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/settings", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleWorkshopSettings(rr, req)
	if rr.Code != http.StatusForbidden && rr.Code != http.StatusUnauthorized {
		// requirePermission typically 403
		if rr.Code != 403 {
			t.Fatalf("vendedor must not put settings, status=%d body=%s", rr.Code, rr.Body.String())
		}
	}

	req2 := withClaims(httptest.NewRequest(http.MethodPut, "/api/settings", strings.NewReader(`{"default_margin_factor":1.4,"default_labor_fixed_cost":0,"default_currency":"MXN","vendedor_can_view_costs":true}`)), "a1", string(domain.RoleAdmin))
	req2.Header.Set("Content-Type", "application/json")
	rr2 := httptest.NewRecorder()
	srv.HandleWorkshopSettings(rr2, req2)
	if rr2.Code != http.StatusOK {
		t.Fatalf("admin put settings status=%d body=%s", rr2.Code, rr2.Body.String())
	}
	var got domain.WorkshopSettings
	if err := json.Unmarshal(rr2.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if !got.VendedorCanViewCosts {
		t.Fatalf("flag not saved: %#v", got)
	}
}
func TestHandleProjectTemplatesList(t *testing.T) {
	templates := []domain.ProjectTemplate{
		{ID: "tmpl-1", Name: "Cocina test", Currency: "MXN", MarginFactor: 1.35, Items: []domain.ProjectItem{}},
	}
	srv := &Server{Store: &stubStore{listProjectTemplates: templates}}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/project-templates", nil), "v1", string(domain.RoleVendedor))
	rr := httptest.NewRecorder()

	srv.HandleProjectTemplates(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var got []domain.ProjectTemplate
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if len(got) != 1 || got[0].ID != "tmpl-1" {
		t.Fatalf("got = %+v, want one tmpl-1", got)
	}
}

func TestHandleProjectTemplatesCreateRequiresEngineer(t *testing.T) {
	// Vendedor cannot create templates — should be 403.
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"tmpl-x","name":"X","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[]}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/project-templates", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjectTemplates(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("vendedor status = %d, want 403", rr.Code)
	}
	if store.lastCreatedTemplate != nil {
		t.Fatalf("vendedor should not have created a template")
	}
}

func TestHandleProjectTemplatesCreateEngineerOK(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"tmpl-x","name":"Cocina 3m","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[]}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/project-templates", body), "v1", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjectTemplates(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.lastCreatedTemplate == nil || store.lastCreatedTemplate.Name != "Cocina 3m" {
		t.Fatalf("created template not captured: %+v", store.lastCreatedTemplate)
	}
}

func TestHandleProjectTemplateByIDDelete(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodDelete, "/api/project-templates/tmpl-x", nil), "v1", string(domain.RoleIngeniero))
	req.SetPathValue("id", "tmpl-x")
	rr := httptest.NewRecorder()

	srv.HandleProjectTemplateByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if !store.deleteTemplateCalled {
		t.Fatalf("expected DeleteProjectTemplate to be called")
	}
}

// --- Catalog media lifecycle cleanup (F040) ---

// writeMediaFile plants a fake media file on disk so we can assert it gets
// deleted by the handler after the corresponding DB row is updated/deleted.
// Files live under the initial organization's subdirectory (partitioned media
// layout, ADR-0004): the unscoped test context falls back to it.
