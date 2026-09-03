package api

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #388 / DT-4: model binding validation handler unit tests (withClaims +
// stubStore, no DB): typed states, uniform 404 for foreign objects, role
// guard and malformed-body fail-closed behavior.

func bindingValidationRequest(method, target, body, role string) *http.Request {
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := withClaims(httptest.NewRequest(method, target, reader), "admin-1", role)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.SetPathValue("projectId", designTestProjectID)
	req.SetPathValue("designId", designTestDesignID)
	return req
}

func validBindingContext() *storage.ModelBindingContext {
	base := designTestRevisionID
	num := 2
	return &storage.ModelBindingContext{
		OrganizationID:   "60000000-0000-0000-0000-000000000001",
		OrganizationName: "Carpintería García",
		ProjectID:        designTestProjectID,
		ProjectName:      "Cocina García",
		Design: domain.Design{
			ID:        designTestDesignID,
			ProjectID: designTestProjectID,
			Name:      "Cocina Principal",
			Status:    domain.DesignStatusActive,
		},
		WorkingCopyBaseRevisionID: &base,
		WorkingCopyUpdatedAt:      time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC),
		BaseRevisionNumber:        &num,
	}
}

func TestHandleProjectDesignBindingValidate_Valid(t *testing.T) {
	store := &stubStore{modelBindingContext: validBindingContext()}
	srv := &Server{Store: store}
	base := designTestRevisionID
	req := bindingValidationRequest(http.MethodPost,
		"/api/projects/"+designTestProjectID+"/designs/"+designTestDesignID+"/binding:validate",
		`{"client_schema_version":1,"base_revision_id":"`+base+`"}`,
		string(domain.RoleVendedor))
	rr := httptest.NewRecorder()

	srv.HandleProjectDesignBindingValidate(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	for _, want := range []string{
		`"state":"valid"`,
		`"schema_version":` + strconv.Itoa(ModelBindingSchemaVersion),
		`"organization":{"id":"60000000-0000-0000-0000-000000000001","name":"Carpintería García"}`,
		`"project":{"id":"` + designTestProjectID + `","name":"Cocina García"}`,
		`"design":{"id":"` + designTestDesignID + `","name":"Cocina Principal","status":"active"}`,
		`"base_revision_id":"` + base + `"`,
		`"base_revision_number":2`,
		`"can_edit_working_copy":true`,
		`"can_publish_revision":true`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("response missing %s: %s", want, body)
		}
	}
}

func TestHandleProjectDesignBindingValidate_ArchivedDesignBlocksCapabilities(t *testing.T) {
	ctx := validBindingContext()
	ctx.Design.Status = domain.DesignStatusArchived
	store := &stubStore{modelBindingContext: ctx}
	srv := &Server{Store: store}
	req := bindingValidationRequest(http.MethodPost,
		"/api/projects/"+designTestProjectID+"/designs/"+designTestDesignID+"/binding:validate",
		`{"client_schema_version":1}`, string(domain.RoleAdmin))
	rr := httptest.NewRecorder()

	srv.HandleProjectDesignBindingValidate(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if !strings.Contains(body, `"state":"design_archived"`) {
		t.Fatalf("want state design_archived: %s", body)
	}
	if !strings.Contains(body, `"can_edit_working_copy":false`) ||
		!strings.Contains(body, `"can_publish_revision":false`) {
		t.Fatalf("archived design must not advertise authoring capabilities: %s", body)
	}
}

func TestHandleProjectDesignBindingValidate_RoleWithoutPublish(t *testing.T) {
	store := &stubStore{modelBindingContext: validBindingContext()}
	srv := &Server{Store: store}
	req := bindingValidationRequest(http.MethodPost,
		"/api/projects/"+designTestProjectID+"/designs/"+designTestDesignID+"/binding:validate",
		`{"client_schema_version":1}`, string(domain.RoleProduccion))
	rr := httptest.NewRecorder()

	srv.HandleProjectDesignBindingValidate(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if !strings.Contains(body, `"can_edit_working_copy":true`) {
		t.Fatalf("producción can read/edit working copy: %s", body)
	}
	if !strings.Contains(body, `"can_publish_revision":false`) {
		t.Fatalf("producción must not publish revisions: %s", body)
	}
}

func TestHandleProjectDesignBindingValidate_ForeignDesignFailsUniform404(t *testing.T) {
	// The store layer resolves foreign/cross-project designs as
	// ErrDesignNotFound (RLS + project match); the handler must keep the
	// uniform 404 — never a partial context leak.
	store := &stubStore{modelBindingContextErr: domain.ErrDesignNotFound}
	srv := &Server{Store: store}
	req := bindingValidationRequest(http.MethodPost,
		"/api/projects/"+designTestProjectID+"/designs/"+designTestDesignID+"/binding:validate",
		`{"client_schema_version":1}`, string(domain.RoleAdmin))
	rr := httptest.NewRecorder()

	srv.HandleProjectDesignBindingValidate(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want uniform 404 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "no existe") {
		t.Fatalf("404 copy mismatch: %s", rr.Body.String())
	}
}

func TestHandleProjectDesignBindingValidate_ForeignBaseRevisionFails404(t *testing.T) {
	store := &stubStore{modelBindingContextErr: domain.ErrDesignRevisionNotFound}
	srv := &Server{Store: store}
	req := bindingValidationRequest(http.MethodPost,
		"/api/projects/"+designTestProjectID+"/designs/"+designTestDesignID+"/binding:validate",
		`{"client_schema_version":1,"base_revision_id":"53000000-0000-0000-0000-0000000000ff"}`,
		string(domain.RoleAdmin))
	rr := httptest.NewRecorder()

	srv.HandleProjectDesignBindingValidate(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestHandleProjectDesignBindingValidate_PermissionDenied(t *testing.T) {
	store := &stubStore{modelBindingContext: validBindingContext()}
	srv := &Server{Store: store}
	// instalador has no project visibility.
	req := bindingValidationRequest(http.MethodPost,
		"/api/projects/"+designTestProjectID+"/designs/"+designTestDesignID+"/binding:validate",
		`{"client_schema_version":1}`, string(domain.RoleAlmacen))
	rr := httptest.NewRecorder()

	srv.HandleProjectDesignBindingValidate(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestHandleProjectDesignBindingValidate_MalformedBodies(t *testing.T) {
	store := &stubStore{modelBindingContext: validBindingContext()}
	srv := &Server{Store: store}
	cases := []struct {
		name string
		body string
	}{
		{"empty body", ""},
		{"not json", "nope"},
		{"missing schema version", `{"base_revision_id":"` + designTestRevisionID + `"}`},
		{"zero schema version", `{"client_schema_version":0}`},
		{"unknown field", `{"client_schema_version":1,"base_revision_id":"` + designTestRevisionID + `","web_jwt":"x"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := bindingValidationRequest(http.MethodPost,
				"/api/projects/"+designTestProjectID+"/designs/"+designTestDesignID+"/binding:validate",
				tc.body, string(domain.RoleAdmin))
			rr := httptest.NewRecorder()
			srv.HandleProjectDesignBindingValidate(rr, req)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
			}
		})
	}
}

func TestHandleProjectDesignBindingValidate_MethodNotAllowed(t *testing.T) {
	store := &stubStore{modelBindingContext: validBindingContext()}
	srv := &Server{Store: store}
	req := bindingValidationRequest(http.MethodPut,
		"/api/projects/"+designTestProjectID+"/designs/"+designTestDesignID+"/binding:validate",
		`{"client_schema_version":1}`, string(domain.RoleAdmin))
	rr := httptest.NewRecorder()

	srv.HandleProjectDesignBindingValidate(rr, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rr.Code)
	}
}
