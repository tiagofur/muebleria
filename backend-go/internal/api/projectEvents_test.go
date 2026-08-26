package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestHandleProjectEvents_List(t *testing.T) {
	now := time.Now().UTC()
	store := &stubStore{
		projectReturnedByID: &domain.Project{ID: "p1", Name: "Proyecto Alpha"},
		projectEventsList: []domain.ProjectEvent{
			{
				ID:        "evt_1",
				ProjectID: "p1",
				Type:      "quote_created",
				At:        now.Add(-48 * time.Hour),
				Source:    domain.ProjectEventSourceWeb,
			},
			{
				ID:        "evt_2",
				ProjectID: "p1",
				Type:      "deposit_received",
				At:        now.Add(-24 * time.Hour),
				Source:    domain.ProjectEventSourceWeb,
				Payload:   json.RawMessage(`{"amount": 1500, "currency": "USD"}`),
			},
		},
	}
	srv := &Server{Store: store}

	req := httptest.NewRequest(http.MethodGet, "/api/projects/p1/events", nil)
	req.SetPathValue("id", "p1")
	rec := httptest.NewRecorder()

	srv.HandleProjectEvents(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}

	var events []domain.ProjectEvent
	if err := json.NewDecoder(rec.Body).Decode(&events); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(events) != 2 {
		t.Fatalf("expected 2 events, got %d", len(events))
	}
	if events[0].Type != "quote_created" {
		t.Errorf("expected event[0] to be quote_created, got %s", events[0].Type)
	}
	if events[1].Type != "deposit_received" {
		t.Errorf("expected event[1] to be deposit_received, got %s", events[1].Type)
	}
}

func TestHandleProjectEvents_ListNotFound(t *testing.T) {
	store := &stubStore{
		projectReturnedByID: nil,
	}
	srv := &Server{Store: store}

	req := httptest.NewRequest(http.MethodGet, "/api/projects/missing/events", nil)
	req.SetPathValue("id", "missing")
	rec := httptest.NewRecorder()

	srv.HandleProjectEvents(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 Not Found, got %d", rec.Code)
	}
}

func TestHandleProjectEvents_Create(t *testing.T) {
	store := &stubStore{
		projectReturnedByID: &domain.Project{ID: "p1", Name: "Proyecto Alpha"},
	}
	srv := &Server{Store: store}

	body := []byte(`{
		"type": "deposit_received",
		"note": "Anticipo 50%",
		"payload": {"amount": 2500, "currency": "USD", "reference": "REC-001"}
	}`)

	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects/p1/events", bytes.NewReader(body)), "u1", string(domain.RoleAdmin))
	req.SetPathValue("id", "p1")
	rec := httptest.NewRecorder()

	srv.HandleProjectEvents(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", rec.Code, rec.Body.String())
	}

	var created domain.ProjectEvent
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if created.Type != "deposit_received" {
		t.Errorf("expected type deposit_received, got %s", created.Type)
	}
	if created.ByUserID == nil || *created.ByUserID != "u1" {
		t.Errorf("expected by_user_id 'u1', got %v", created.ByUserID)
	}
	if len(store.projectEventWrites) != 1 {
		t.Fatalf("expected 1 write to store, got %d", len(store.projectEventWrites))
	}
	if store.projectEventWrites[0].Type != "deposit_received" {
		t.Errorf("expected written type to be deposit_received, got %s", store.projectEventWrites[0].Type)
	}
}

func TestHandleProjectEvents_CreateValidation(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}

	// Missing type
	req := httptest.NewRequest(http.MethodPost, "/api/projects/p1/events", bytes.NewReader([]byte(`{"note": "sin tipo"}`)))
	req.SetPathValue("id", "p1")
	rec := httptest.NewRecorder()

	srv.HandleProjectEvents(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request on missing type, got %d", rec.Code)
	}
}

func TestHandleProjectEvents_CreateRejectsUnknownType(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}

	body := []byte(`{"type": "pizza_delivered", "note": "tipo inventado"}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects/p1/events", bytes.NewReader(body)), "u1", string(domain.RoleAdmin))
	req.SetPathValue("id", "p1")
	rec := httptest.NewRecorder()

	srv.HandleProjectEvents(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request on unknown event type, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(store.projectEventWrites) != 0 {
		t.Fatalf("expected no writes for unknown event type, got %d", len(store.projectEventWrites))
	}
}

func TestHandleProjectEvents_CreateRBAC(t *testing.T) {
	cases := []struct {
		name     string
		role     domain.UserRole
		event    string
		wantCode int
	}{
		{"vendedor puede registrar anticipo", domain.RoleVendedor, "deposit_received", http.StatusCreated},
		{"vendedor NO puede liberar a producción", domain.RoleVendedor, "production_released", http.StatusForbidden},
		{"vendedor NO puede aprobar orden de cambio", domain.RoleVendedor, "change_order_approved", http.StatusForbidden},
		{"produccion NO puede liberar a producción", domain.RoleProduccion, "production_released", http.StatusForbidden},
		{"ingeniero puede liberar a producción", domain.RoleIngeniero, "production_released", http.StatusCreated},
		{"gerente_produccion puede aprobar orden de cambio", domain.RoleGerenteProduccion, "change_order_approved", http.StatusCreated},
		{"almacen puede marcar materiales listos", domain.RoleAlmacen, "materials_ready", http.StatusCreated},
		{"almacen NO puede cerrar proyecto", domain.RoleAlmacen, "project_closed", http.StatusForbidden},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := &stubStore{
				projectReturnedByID: &domain.Project{ID: "p1", Name: "Proyecto Alpha"},
			}
			srv := &Server{Store: store}

			body, _ := json.Marshal(map[string]string{"type": tc.event})
			req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects/p1/events", bytes.NewReader(body)), "u1", string(tc.role))
			req.SetPathValue("id", "p1")
			rec := httptest.NewRecorder()

			srv.HandleProjectEvents(rec, req)

			if rec.Code != tc.wantCode {
				t.Fatalf("expected %d for role=%s type=%s, got %d: %s", tc.wantCode, tc.role, tc.event, rec.Code, rec.Body.String())
			}
			if tc.wantCode == http.StatusCreated && len(store.projectEventWrites) != 1 {
				t.Fatalf("expected 1 write, got %d", len(store.projectEventWrites))
			}
		})
	}
}

func TestAuthorizeProjectEventAppends(t *testing.T) {
	existing := []domain.ProjectEvent{
		{ID: "evt_1", ProjectID: "p1", Type: "quote_won"},
	}

	t.Run("permite reenviar el log existente", func(t *testing.T) {
		rec := httptest.NewRecorder()
		if !authorizeProjectEventAppends(rec, []domain.UserRole{domain.RoleVendedor}, existing, existing) {
			t.Fatalf("expected resend of existing log to be allowed, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("rechaza evento nuevo fuera del rol", func(t *testing.T) {
		incoming := append(append([]domain.ProjectEvent{}, existing...),
			domain.ProjectEvent{ID: "evt_2", ProjectID: "p1", Type: "production_released"})
		rec := httptest.NewRecorder()
		if authorizeProjectEventAppends(rec, []domain.UserRole{domain.RoleVendedor}, existing, incoming) {
			t.Fatal("expected vendedor injecting production_released via PUT to be rejected")
		}
		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403, got %d", rec.Code)
		}
	})

	t.Run("rechaza tipo inventado", func(t *testing.T) {
		incoming := []domain.ProjectEvent{{ID: "evt_2", ProjectID: "p1", Type: "foo_bar"}}
		rec := httptest.NewRecorder()
		if authorizeProjectEventAppends(rec, []domain.UserRole{domain.RoleAdmin}, existing, incoming) {
			t.Fatal("expected invented event type to be rejected")
		}
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", rec.Code)
		}
	})

	t.Run("permite evento nuevo dentro del rol", func(t *testing.T) {
		incoming := append(append([]domain.ProjectEvent{}, existing...),
			domain.ProjectEvent{ID: "evt_2", ProjectID: "p1", Type: "production_released"})
		rec := httptest.NewRecorder()
		if !authorizeProjectEventAppends(rec, []domain.UserRole{domain.RoleIngeniero}, existing, incoming) {
			t.Fatalf("expected ingeniero appending production_released to be allowed, got %d: %s", rec.Code, rec.Body.String())
		}
	})
}
