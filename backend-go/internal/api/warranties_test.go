package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

type warrantiesTestStore struct {
	stubStore
	tickets       map[string]*domain.WarrantyTicket
	photos        map[string][]domain.WarrantyTicketPhoto
	createdTicket *domain.WarrantyTicket
	updatedTicket *domain.WarrantyTicket
}

func (s *warrantiesTestStore) ListWarrantyTickets(_ context.Context, projectID, _, _ string) ([]domain.WarrantyTicket, error) {
	var list []domain.WarrantyTicket
	for _, t := range s.tickets {
		if projectID == "" || t.ProjectID == projectID {
			list = append(list, *t)
		}
	}
	return list, nil
}

func (s *warrantiesTestStore) GetWarrantyTicketByID(_ context.Context, id string) (*domain.WarrantyTicket, error) {
	t, ok := s.tickets[id]
	if !ok {
		return nil, nil
	}
	cp := *t
	cp.Photos = s.photos[id]
	return &cp, nil
}

func (s *warrantiesTestStore) CreateWarrantyTicket(_ context.Context, t *domain.WarrantyTicket) error {
	t.CreatedAt = time.Now()
	t.UpdatedAt = time.Now()
	s.createdTicket = t
	if s.tickets == nil {
		s.tickets = make(map[string]*domain.WarrantyTicket)
	}
	s.tickets[t.ID] = t
	return nil
}

func (s *warrantiesTestStore) UpdateWarrantyTicket(_ context.Context, t *domain.WarrantyTicket) error {
	t.UpdatedAt = time.Now()
	s.updatedTicket = t
	s.tickets[t.ID] = t
	return nil
}

func (s *warrantiesTestStore) DeleteWarrantyTicket(_ context.Context, id string) error {
	delete(s.tickets, id)
	return nil
}

func (s *warrantiesTestStore) ListWarrantyTicketPhotos(_ context.Context, ticketID string) ([]domain.WarrantyTicketPhoto, error) {
	return s.photos[ticketID], nil
}

func (s *warrantiesTestStore) AddWarrantyTicketPhoto(_ context.Context, photo *domain.WarrantyTicketPhoto) error {
	if s.photos == nil {
		s.photos = make(map[string][]domain.WarrantyTicketPhoto)
	}
	s.photos[photo.TicketID] = append(s.photos[photo.TicketID], *photo)
	return nil
}

func (s *warrantiesTestStore) DeleteWarrantyTicketPhoto(_ context.Context, ticketID, photoID string) error {
	photos := s.photos[ticketID]
	var remaining []domain.WarrantyTicketPhoto
	for _, p := range photos {
		if p.ID != photoID {
			remaining = append(remaining, p)
		}
	}
	s.photos[ticketID] = remaining
	return nil
}

func TestHandleWarrantyTickets_CreateAndList(t *testing.T) {
	store := &warrantiesTestStore{
		tickets: make(map[string]*domain.WarrantyTicket),
	}
	srv := NewServer(store, "test-secret", nil, 100, 100)

	body, _ := json.Marshal(map[string]any{
		"project_id":  "proj-100",
		"title":       "Frente rayado en obra",
		"description": "Se rayó el frente de cajón durante la instalación",
		"category":    "damaged_part",
		"priority":    "urgent",
		"refabrication_pieces": []map[string]any{
			{
				"piece_description": "Frente Cajon 800",
				"material_name":     "Roble Nebraska",
				"length_mm":         796,
				"width_mm":          196,
				"quantity":          1,
				"grain":             1,
				"L1":                1,

				"L2": 1,
				"W1": 1,
				"W2": 1,
			},
		},
	})

	req := httptest.NewRequest(http.MethodPost, "/api/warranties", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	srv.HandleWarrantyTickets(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", w.Code, w.Body.String())
	}

	var created domain.WarrantyTicket
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if created.Title != "Frente rayado en obra" {
		t.Errorf("expected title 'Frente rayado en obra', got '%s'", created.Title)
	}
	if len(created.RefabricationPieces) != 1 {
		t.Errorf("expected 1 refabrication piece, got %d", len(created.RefabricationPieces))
	}
	if created.Category != domain.WarrantyCategoryDamagedPart {
		t.Errorf("expected category damaged_part, got %s", created.Category)
	}

	// Now list tickets
	listReq := httptest.NewRequest(http.MethodGet, "/api/warranties?project_id=proj-100", nil)
	listW := httptest.NewRecorder()

	srv.HandleWarrantyTickets(listW, listReq)

	if listW.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on list, got %d", listW.Code)
	}

	var list []domain.WarrantyTicket
	if err := json.NewDecoder(listW.Body).Decode(&list); err != nil {
		t.Fatalf("failed to decode list response: %v", err)
	}

	if len(list) != 1 {
		t.Errorf("expected 1 ticket in list, got %d", len(list))
	}
}

func TestHandleWarrantyTicketByID_UpdateAndResolve(t *testing.T) {
	ticket := &domain.WarrantyTicket{
		ID:           "ticket-1",
		TicketNumber: "GAR-001",
		ProjectID:    "proj-100",
		Title:        "Ajuste bisagra",
		Category:     domain.WarrantyCategoryHardwareAdjustment,
		Priority:     domain.WarrantyPriorityNormal,
		Status:       domain.WarrantyStatusOpen,
	}

	store := &warrantiesTestStore{
		tickets: map[string]*domain.WarrantyTicket{
			"ticket-1": ticket,
		},
	}
	srv := NewServer(store, "test-secret", nil, 100, 100)

	// Update ticket status to resolved with notes
	resNotes := "Se cambiaron tornillos y se calibró la bisagra"
	newStatus := string(domain.WarrantyStatusResolved)
	patchBody, _ := json.Marshal(map[string]any{
		"status":           newStatus,
		"resolution_notes": resNotes,
	})

	req := httptest.NewRequest(http.MethodPatch, "/api/warranties/ticket-1", bytes.NewReader(patchBody))
	req.SetPathValue("id", "ticket-1")
	w := httptest.NewRecorder()

	srv.HandleWarrantyTicketByID(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on patch, got %d: %s", w.Code, w.Body.String())
	}

	if store.updatedTicket.Status != domain.WarrantyStatusResolved {
		t.Errorf("expected status resolved, got %s", store.updatedTicket.Status)
	}
	if store.updatedTicket.ResolutionNotes != resNotes {
		t.Errorf("expected resolution notes, got '%s'", store.updatedTicket.ResolutionNotes)
	}
	if store.updatedTicket.ResolvedAt == nil {
		t.Errorf("expected ResolvedAt timestamp to be auto-populated on resolution")
	}
}

func TestHandleWarrantyTicketPhotos(t *testing.T) {
	ticket := &domain.WarrantyTicket{
		ID:           "ticket-1",
		TicketNumber: "GAR-001",
		ProjectID:    "proj-100",
		Title:        "Ajuste bisagra",
		Status:       domain.WarrantyStatusOpen,
	}

	store := &warrantiesTestStore{
		tickets: map[string]*domain.WarrantyTicket{
			"ticket-1": ticket,
		},
		photos: make(map[string][]domain.WarrantyTicketPhoto),
	}
	srv := NewServer(store, "test-secret", nil, 100, 100)

	body, _ := json.Marshal(map[string]any{
		"kind":          "issue_report",
		"url":           "https://example.com/photo.jpg",
		"thumbnail_url": "https://example.com/photo_thumb.jpg",
		"caption":       "Detalle del rayón",
	})

	req := httptest.NewRequest(http.MethodPost, "/api/warranties/ticket-1/photos", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "ticket-1")
	w := httptest.NewRecorder()

	srv.HandleWarrantyTicketPhotos(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created on photo upload, got %d: %s", w.Code, w.Body.String())
	}

	photos := store.photos["ticket-1"]
	if len(photos) != 1 {
		t.Fatalf("expected 1 photo saved, got %d", len(photos))
	}
	if photos[0].Caption != "Detalle del rayón" {
		t.Errorf("expected caption 'Detalle del rayón', got '%s'", photos[0].Caption)
	}
}
