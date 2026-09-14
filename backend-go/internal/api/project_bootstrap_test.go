package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func bootstrapBindingContext() *storage.ModelBindingContext {
	return &storage.ModelBindingContext{
		OrganizationID: "10000000-0000-0000-0000-000000000001", OrganizationName: "Taller",
		ProjectID: "71000000-0000-0000-0000-000000000718", ProjectName: "Cocina Ana",
		CustomerID: "70000000-0000-0000-0000-000000000718", CustomerName: "Cliente",
		Design:               domain.Design{ID: "72000000-0000-0000-0000-000000000718", ProjectID: "71000000-0000-0000-0000-000000000718", Name: "Diseño principal", Status: domain.DesignStatusActive},
		WorkingCopyUpdatedAt: time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC),
	}
}

func bootstrapRequest(body string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/api/projects:bootstrap-design", bytes.NewBufferString(body))
	return withTestClaims(req, "10000000-0000-0000-0000-000000000099", []domain.UserRole{domain.RoleAdmin})
}

func TestHandleCustomerSummaries_ActivePortfolioOnly(t *testing.T) {
	store := &stubStore{listCustomers: []domain.Customer{
		{ID: "10000000-0000-0000-0000-000000000001", Name: "Ana", Active: true, OwnerUserID: "seller"},
		{ID: "10000000-0000-0000-0000-000000000002", Name: "Otra", Active: true, OwnerUserID: "other"},
		{ID: "10000000-0000-0000-0000-000000000003", Name: "Inactiva", Active: false, OwnerUserID: "seller"},
	}}
	req := withTestClaims(httptest.NewRequest(http.MethodGet, "/api/customers/summaries", nil), "seller", []domain.UserRole{domain.RoleVendedor})
	w := httptest.NewRecorder()
	(&Server{Store: store}).HandleCustomerSummaries(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var got []openapi.CustomerSummary
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil || len(got) != 1 || got[0].Name != "Ana" {
		t.Fatalf("summaries=%+v err=%v", got, err)
	}
}

func TestHandleProjectDesignBootstrap_NewAndExistingCustomer(t *testing.T) {
	for name, body := range map[string]string{
		"new":      `{"projectName":"Cocina Ana","designName":"Diseño principal","newCustomer":{"name":"Ana López"}}`,
		"existing": `{"projectName":"Cocina Ana","designName":"Diseño principal","existingCustomerId":"10000000-0000-0000-0000-000000000001"}`,
	} {
		t.Run(name, func(t *testing.T) {
			store := &stubStore{modelBindingContext: bootstrapBindingContext()}
			w := httptest.NewRecorder()
			(&Server{Store: store}).HandleProjectDesignBootstrap(w, bootstrapRequest(body))
			if w.Code != http.StatusCreated {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			if store.bootstrapProjectDesignCmd == nil || store.bootstrapProjectDesignCmd.ProjectName != "Cocina Ana" {
				t.Fatalf("command=%+v", store.bootstrapProjectDesignCmd)
			}
			var got openapi.ProjectDesignBootstrapResponse
			if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil || got.Binding.Project.ID != bootstrapBindingContext().ProjectID || got.Binding.Capabilities.CanEditWorkingCopy != true {
				t.Fatalf("response=%+v err=%v", got, err)
			}
		})
	}
}

func TestHandleProjectDesignBootstrap_StrictSelectorAndPermissions(t *testing.T) {
	invalid := []string{
		`{"projectName":"P","designName":"D"}`,
		`{"projectName":"P","designName":"D","existingCustomerId":"10000000-0000-0000-0000-000000000001","newCustomer":{"name":"Ana"}}`,
		`{"projectName":"P","designName":"D","newCustomer":{"name":"Ana"},"projectId":"client-id"}`,
	}
	for _, body := range invalid {
		store := &stubStore{modelBindingContext: bootstrapBindingContext()}
		w := httptest.NewRecorder()
		(&Server{Store: store}).HandleProjectDesignBootstrap(w, bootstrapRequest(body))
		if w.Code != http.StatusBadRequest || store.bootstrapProjectDesignCmd != nil {
			t.Fatalf("body=%s status=%d response=%s", body, w.Code, w.Body.String())
		}
	}

	request := httptest.NewRequest(http.MethodPost, "/api/projects:bootstrap-design", bytes.NewBufferString(`{"projectName":"P","designName":"D","newCustomer":{"name":"Ana"}}`))
	request = withTestClaims(request, "producer", []domain.UserRole{domain.RoleProduccion})
	w := httptest.NewRecorder()
	(&Server{Store: &stubStore{}}).HandleProjectDesignBootstrap(w, request)
	if w.Code != http.StatusForbidden {
		t.Fatalf("production status=%d", w.Code)
	}
}

func TestHandleProjectDesignBootstrap_IdempotentReplayAndIntentConflict(t *testing.T) {
	store := &quoteLifecycleIdempotentStore{stubStore: &stubStore{modelBindingContext: bootstrapBindingContext()}, receipts: map[string]storage.IdempotencyResponse{}}
	server := &Server{Store: store}
	handler := server.RequireIdempotency("project.bootstrap-design", http.HandlerFunc(server.HandleProjectDesignBootstrap))
	serve := func(body string) *httptest.ResponseRecorder {
		req := bootstrapRequest(body)
		req.Header.Set("Idempotency-Key", "sketchup-bootstrap-intent-718")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w
	}
	body := `{"projectName":"P","designName":"D","newCustomer":{"name":"Ana"}}`
	first, replay := serve(body), serve(body)
	if first.Code != http.StatusCreated || replay.Code != http.StatusCreated || replay.Header().Get("Idempotency-Replayed") != "true" {
		t.Fatalf("first=%d replay=%d headers=%v", first.Code, replay.Code, replay.Header())
	}
	conflict := serve(`{"projectName":"Otra","designName":"D","newCustomer":{"name":"Ana"}}`)
	if conflict.Code != http.StatusConflict || !bytes.Contains(conflict.Body.Bytes(), []byte("IDEMPOTENCY_CONFLICT")) {
		t.Fatalf("conflict=%d body=%s", conflict.Code, conflict.Body.String())
	}
}

func TestExtensionClientBoundarySketchUpCommercialBootstrap(t *testing.T) {
	projectID := "71000000-0000-0000-0000-000000000718"
	designID := "72000000-0000-0000-0000-000000000718"
	allowed := [][2]string{
		{http.MethodGet, "/api/customers/summaries"},
		{http.MethodPost, "/api/projects:bootstrap-design"},
		{http.MethodPost, "/api/projects/" + projectID + "/designs/" + designID + "/quote-revisions"},
	}
	for _, item := range allowed {
		if !extensionClientMayAccess(item[0], item[1]) {
			t.Errorf("expected allowed: %s %s", item[0], item[1])
		}
	}
	denied := [][2]string{
		{http.MethodGet, "/api/customers"}, {http.MethodPost, "/api/customers"},
		{http.MethodPost, "/api/projects"},
		{http.MethodPost, "/api/projects/" + projectID + "/quote-revisions"},
		{http.MethodPost, "/api/projects/" + projectID + "/quote-revisions:requote"},
	}
	for _, item := range denied {
		if extensionClientMayAccess(item[0], item[1]) {
			t.Errorf("expected denied: %s %s", item[0], item[1])
		}
	}
}
