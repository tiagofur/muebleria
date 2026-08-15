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

type messagesTestStore struct {
	stubStore
	messages       map[string][]domain.ProjectInternalMessage
	createdMessage *domain.ProjectInternalMessage
	updatedStatus  string
	assignedEngID  *string
}

func (m *messagesTestStore) ListProjectInternalMessages(_ context.Context, projectID string) ([]domain.ProjectInternalMessage, error) {
	return m.messages[projectID], nil
}

func (m *messagesTestStore) CreateProjectInternalMessage(_ context.Context, msg *domain.ProjectInternalMessage) error {
	msg.ID = "msg-123"
	msg.CreatedAt = time.Now()
	m.createdMessage = msg
	return nil
}

func (m *messagesTestStore) UpdateProjectTechnicalWorkflow(
	_ context.Context,
	_ string,
	engineerID *string,
	status string,
	_ *string,
	_ *string,
) error {
	m.assignedEngID = engineerID
	m.updatedStatus = status
	return nil
}

func (m *messagesTestStore) GetProjectByID(_ context.Context, id string) (*domain.Project, error) {
	return &domain.Project{
		ID:              id,
		Name:            "Cocina Moderna",
		TechnicalStatus: string(domain.TechStatusPendingAssignment),
	}, nil
}

func TestHandleProjectInternalMessages_ListAndCreate(t *testing.T) {
	store := &messagesTestStore{
		messages: map[string][]domain.ProjectInternalMessage{
			"proj-1": {
				{
					ID:          "m-1",
					ProjectID:   "proj-1",
					SenderName:  "Carlos Ventas",
					MessageType: domain.InternalMsgComment,
					Content:     "Cliente confirmó herrajes negros",
					CreatedAt:   time.Now(),
				},
			},
		},
	}

	server := &Server{
		Store:     store,
		JWTSecret: "test-secret",
	}

	// 1. GET /api/projects/proj-1/messages
	req := httptest.NewRequest(http.MethodGet, "/api/projects/proj-1/messages", nil)
	req.SetPathValue("id", "proj-1")
	w := httptest.NewRecorder()

	server.HandleProjectInternalMessages(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var list []domain.ProjectInternalMessage
	if err := json.NewDecoder(w.Body).Decode(&list); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(list) != 1 || list[0].Content != "Cliente confirmó herrajes negros" {
		t.Fatalf("unexpected message list: %+v", list)
	}

	// 2. POST /api/projects/proj-1/messages (technical query)
	body, _ := json.Marshal(map[string]interface{}{
		"sender_name":  "Ing. Roberto",
		"message_type": "technical_query",
		"content":      "¿El zócalo va de 100mm o 150mm?",
	})
	postReq := httptest.NewRequest(http.MethodPost, "/api/projects/proj-1/messages", bytes.NewReader(body))
	postReq.Header.Set("Content-Type", "application/json")
	postReq.SetPathValue("id", "proj-1")
	postW := httptest.NewRecorder()

	server.HandleProjectInternalMessages(postW, postReq)

	if postW.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d: %s", postW.Code, postW.Body.String())
	}
	if store.createdMessage == nil || store.createdMessage.MessageType != domain.InternalMsgTechnicalQuery {
		t.Fatalf("expected technical query message, got: %+v", store.createdMessage)
	}
}

func TestHandleProjectTechnicalWorkflow_Update(t *testing.T) {
	store := &messagesTestStore{}
	server := &Server{
		Store:     store,
		JWTSecret: "test-secret",
	}

	engID := "user-eng-99"
	body, _ := json.Marshal(map[string]interface{}{
		"assigned_engineer_id": engID,
		"technical_status":     "approved_for_production",
		"comment":              "Revisión de planos OK para corte",
	})
	req := httptest.NewRequest(http.MethodPatch, "/api/projects/proj-1/technical-workflow", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "proj-1")
	w := httptest.NewRecorder()

	server.HandleProjectTechnicalWorkflow(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	if store.updatedStatus != "approved_for_production" {
		t.Errorf("expected technical status approved_for_production, got %s", store.updatedStatus)
	}
	if store.assignedEngID == nil || *store.assignedEngID != engID {
		t.Errorf("expected engineer %s, got %v", engID, store.assignedEngID)
	}
	if store.createdMessage == nil || store.createdMessage.MessageType != domain.InternalMsgGateApproval {
		t.Errorf("expected automatic gate approval message, got %+v", store.createdMessage)
	}
}
