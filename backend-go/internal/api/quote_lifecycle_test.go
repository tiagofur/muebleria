package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #571 / WEB-DT-4: commercial QuoteRevision lifecycle HTTP surface.

const (
	quoteLifecycleTestProjectID = "10000000-0000-0000-0000-000000000011"
	quoteLifecycleTestRevID     = "20000000-0000-0000-0000-000000000021"
)

func newCreateQuoteRevisionRequest(claimsUserID string, roles []domain.UserRole, body string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/api/projects/"+quoteLifecycleTestProjectID+"/quote-revisions", bytes.NewBufferString(body))
	req.SetPathValue("projectId", quoteLifecycleTestProjectID)
	if claimsUserID != "" {
		req = withTestClaims(req, claimsUserID, roles)
	}
	return req
}

func newQuoteLifecycleCommandRequest(methodTarget string, claimsUserID string, roles []domain.UserRole) *http.Request {
	req := httptest.NewRequest(http.MethodPost, methodTarget, nil)
	req.SetPathValue("projectId", quoteLifecycleTestProjectID)
	req.SetPathValue("quoteRevisionId", quoteLifecycleTestRevID)
	if claimsUserID != "" {
		req = withTestClaims(req, claimsUserID, roles)
	}
	return req
}

func TestHandleCreateInitialQuoteRevision_Unauthorized(t *testing.T) {
	server := &Server{Store: &stubStore{}}
	w := httptest.NewRecorder()
	server.HandleCreateInitialQuoteRevision(w, newCreateQuoteRevisionRequest("", nil, `{}`))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestHandleCreateInitialQuoteRevision_Permissions(t *testing.T) {
	// Commercial mutation (quote:edit semantics): vendedor yes, read-only
	// production role no.
	server := &Server{Store: &stubStore{}}

	req := newCreateQuoteRevisionRequest("user-1", []domain.UserRole{domain.RoleVendedor}, `{}`)
	w := httptest.NewRecorder()
	server.HandleCreateInitialQuoteRevision(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected vendedor to create, got %d: %s", w.Code, w.Body.String())
	}

	req = newCreateQuoteRevisionRequest("user-2", []domain.UserRole{domain.RoleProduccion}, `{}`)
	w = httptest.NewRecorder()
	server.HandleCreateInitialQuoteRevision(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for producción, got %d", w.Code)
	}
}

func TestHandleCreateInitialQuoteRevision_InvalidProjectAndTypedErrors(t *testing.T) {
	server := &Server{Store: &stubStore{}}

	req := httptest.NewRequest(http.MethodPost, "/api/projects/not-uuid/quote-revisions", bytes.NewBufferString(`{}`))
	req.SetPathValue("projectId", "not-uuid")
	req = withTestClaims(req, "user-1", []domain.UserRole{domain.RoleAdmin})
	w := httptest.NewRecorder()
	server.HandleCreateInitialQuoteRevision(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid projectId, got %d", w.Code)
	}

	req = newCreateQuoteRevisionRequest("user-1", []domain.UserRole{domain.RoleAdmin}, `not-json`)
	w = httptest.NewRecorder()
	server.HandleCreateInitialQuoteRevision(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid body, got %d", w.Code)
	}

	// Typed business conflicts: already-has-revisions (409 CONFLICT), legacy
	// accepted project (409 CONFLICT), no quote lines (409 CONFLICT), missing
	// project (404).
	cases := []struct {
		name string
		err  error
		code int
	}{
		{"already has revisions", domain.ErrQuoteRevisionConflict, http.StatusConflict},
		{"legacy accepted", domain.ErrQuoteRevisionAccepted, http.StatusConflict},
		{"no quote lines", domain.ErrInvalidRevisionSnapshot, http.StatusConflict},
		{"missing project", domain.ErrDesignNotFound, http.StatusNotFound},
		{"not owner org", domain.ErrFurnitureInstanceProjectNotWritable, http.StatusForbidden},
	}
	for _, tc := range cases {
		store := &stubStore{createInitialQuoteRevisionErr: tc.err}
		server := &Server{Store: store}
		w := httptest.NewRecorder()
		server.HandleCreateInitialQuoteRevision(w, newCreateQuoteRevisionRequest("user-1", []domain.UserRole{domain.RoleAdmin}, `{"notes":"Q1"}`))
		if w.Code != tc.code {
			t.Fatalf("%s: expected %d, got %d: %s", tc.name, tc.code, w.Code, w.Body.String())
		}
	}
}

func TestHandleCreateInitialQuoteRevision_Success(t *testing.T) {
	store := &stubStore{}
	server := &Server{Store: store}
	req := newCreateQuoteRevisionRequest("user-1", []domain.UserRole{domain.RoleAdmin}, `{"notes":"Cotización inicial cocina"}`)
	w := httptest.NewRecorder()

	server.HandleCreateInitialQuoteRevision(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	if store.createInitialQuoteRevisionCalls != 1 {
		t.Fatalf("expected exactly one store call, got %d", store.createInitialQuoteRevisionCalls)
	}
	cmd := store.createInitialQuoteRevisionCmd
	if cmd == nil || cmd.ProjectID != quoteLifecycleTestProjectID || cmd.Notes != "Cotización inicial cocina" {
		t.Fatalf("command not forwarded verbatim: %+v", cmd)
	}

	var rev openapi.QuoteRevision
	if err := json.NewDecoder(w.Body).Decode(&rev); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if rev.Status != openapi.QuoteRevisionStatusDraft {
		t.Errorf("created revision status = %s, want draft", rev.Status)
	}
	if rev.RevisionNumber != 1 {
		t.Errorf("created revision number = %d, want 1", rev.RevisionNumber)
	}
}

func TestHandleQuoteRevisionPublish_PermissionsAndValidation(t *testing.T) {
	server := &Server{Store: &stubStore{}}

	// Commercial mutation: vendedor publishes; producción cannot.
	w := httptest.NewRecorder()
	server.HandleQuoteRevisionPublish(w, newQuoteLifecycleCommandRequest("/api/projects/"+quoteLifecycleTestProjectID+"/quote-revisions/"+quoteLifecycleTestRevID+":publish", "user-1", []domain.UserRole{domain.RoleVendedor}))
	if w.Code != http.StatusOK {
		t.Fatalf("expected vendedor to publish, got %d: %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	server.HandleQuoteRevisionPublish(w, newQuoteLifecycleCommandRequest("/api/projects/"+quoteLifecycleTestProjectID+"/quote-revisions/"+quoteLifecycleTestRevID+":publish", "user-2", []domain.UserRole{domain.RoleProduccion}))
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for producción, got %d", w.Code)
	}

	// Invalid IDs.
	req := httptest.NewRequest(http.MethodPost, "/api/projects/"+quoteLifecycleTestProjectID+"/quote-revisions/not-uuid:publish", nil)
	req.SetPathValue("projectId", quoteLifecycleTestProjectID)
	req.SetPathValue("quoteRevisionId", "not-uuid")
	req = withTestClaims(req, "user-1", []domain.UserRole{domain.RoleAdmin})
	w = httptest.NewRecorder()
	server.HandleQuoteRevisionPublish(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid quoteRevisionId, got %d", w.Code)
	}
}

func TestHandleQuoteRevisionPublish_TypedErrors(t *testing.T) {
	cases := []struct {
		name string
		err  error
		code int
	}{
		{"cross-project/missing revision", domain.ErrQuoteRevisionNotFound, http.StatusNotFound},
		{"not owner org", domain.ErrFurnitureInstanceProjectNotWritable, http.StatusForbidden},
		{"already published", domain.ErrQuoteRevisionInvalidTransition, http.StatusConflict},
		{"accepted cannot republish", domain.ErrQuoteRevisionInvalidTransition, http.StatusConflict},
	}
	for _, tc := range cases {
		store := &stubStore{publishQuoteRevisionErr: tc.err}
		server := &Server{Store: store}
		w := httptest.NewRecorder()
		server.HandleQuoteRevisionPublish(w, newQuoteLifecycleCommandRequest("/api/projects/"+quoteLifecycleTestProjectID+"/quote-revisions/"+quoteLifecycleTestRevID+":publish", "user-1", []domain.UserRole{domain.RoleAdmin}))
		if w.Code != tc.code {
			t.Fatalf("%s: expected %d, got %d: %s", tc.name, tc.code, w.Code, w.Body.String())
		}
	}
}

func TestHandleQuoteRevisionAccept_Permissions(t *testing.T) {
	// Acceptance is a commercial sign-off (admin/gerente_ventas): vendedor
	// publishes but never accepts, mirroring RoleCanApproveDesignRevisions.
	server := &Server{Store: &stubStore{}}

	w := httptest.NewRecorder()
	server.HandleQuoteRevisionAccept(w, newQuoteLifecycleCommandRequest("/api/projects/"+quoteLifecycleTestProjectID+"/quote-revisions/"+quoteLifecycleTestRevID+":accept", "user-1", []domain.UserRole{domain.RoleVendedor}))
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for vendedor, got %d", w.Code)
	}

	w = httptest.NewRecorder()
	server.HandleQuoteRevisionAccept(w, newQuoteLifecycleCommandRequest("/api/projects/"+quoteLifecycleTestProjectID+"/quote-revisions/"+quoteLifecycleTestRevID+":accept", "user-2", []domain.UserRole{domain.RoleGerenteVentas}))
	if w.Code != http.StatusOK {
		t.Fatalf("expected gerente_ventas to accept, got %d: %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	server.HandleQuoteRevisionAccept(w, newQuoteLifecycleCommandRequest("/api/projects/"+quoteLifecycleTestProjectID+"/quote-revisions/"+quoteLifecycleTestRevID+":accept", "user-3", []domain.UserRole{domain.RoleAdmin}))
	if w.Code != http.StatusOK {
		t.Fatalf("expected admin to accept, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleQuoteRevisionAccept_TypedErrors(t *testing.T) {
	cases := []struct {
		name string
		err  error
		code int
	}{
		{"draft requires publish first", domain.ErrQuoteRevisionInvalidTransition, http.StatusConflict},
		{"already accepted", domain.ErrQuoteRevisionInvalidTransition, http.StatusConflict},
		{"superseded is terminal", domain.ErrQuoteRevisionInvalidTransition, http.StatusConflict},
		{"cross-project/missing revision", domain.ErrQuoteRevisionNotFound, http.StatusNotFound},
	}
	for _, tc := range cases {
		store := &stubStore{acceptQuoteRevisionErr: tc.err}
		server := &Server{Store: store}
		w := httptest.NewRecorder()
		server.HandleQuoteRevisionAccept(w, newQuoteLifecycleCommandRequest("/api/projects/"+quoteLifecycleTestProjectID+"/quote-revisions/"+quoteLifecycleTestRevID+":accept", "user-1", []domain.UserRole{domain.RoleAdmin}))
		if w.Code != tc.code {
			t.Fatalf("%s: expected %d, got %d: %s", tc.name, tc.code, w.Code, w.Body.String())
		}
	}
}

func TestHandleQuoteRevisionAccept_SuccessForwardsExactIDs(t *testing.T) {
	store := &stubStore{}
	server := &Server{Store: store}
	w := httptest.NewRecorder()

	server.HandleQuoteRevisionAccept(w, newQuoteLifecycleCommandRequest("/api/projects/"+quoteLifecycleTestProjectID+"/quote-revisions/"+quoteLifecycleTestRevID+":accept", "user-1", []domain.UserRole{domain.RoleAdmin}))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	cmd := store.acceptQuoteRevisionCmd
	if cmd == nil || cmd.ProjectID != quoteLifecycleTestProjectID || cmd.QuoteRevisionID != quoteLifecycleTestRevID {
		t.Fatalf("exact IDs not forwarded: %+v", cmd)
	}

	var rev openapi.QuoteRevision
	if err := json.NewDecoder(w.Body).Decode(&rev); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if rev.Status != openapi.QuoteRevisionStatusAccepted {
		t.Errorf("accepted revision status = %s, want accepted", rev.Status)
	}
}

// quoteLifecycleIdempotentStore wraps the stubStore with the durable
// idempotency contract (same pattern as requoteIdempotentStore).
type quoteLifecycleIdempotentStore struct {
	*stubStore
	receipts map[string]storage.IdempotencyResponse
}

func (s *quoteLifecycleIdempotentStore) ExecuteIdempotent(ctx context.Context, req storage.IdempotencyRequest, execute func(context.Context) (storage.IdempotencyResponse, error)) (storage.IdempotencyResponse, bool, error) {
	if receipt, ok := s.receipts[req.ScopeKey]; ok {
		return receipt, true, nil
	}
	response, err := execute(ctx)
	if err != nil {
		return storage.IdempotencyResponse{}, false, storage.ErrIdempotencyRollback
	}
	if response.Status >= 500 {
		return response, false, nil
	}
	s.receipts[req.ScopeKey] = response
	return response, false, nil
}

func idempotentLifecycleRequest(target string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, target, nil)
	req.SetPathValue("projectId", quoteLifecycleTestProjectID)
	req.SetPathValue("quoteRevisionId", quoteLifecycleTestRevID)
	req = withTestClaims(req, "user-1", []domain.UserRole{domain.RoleAdmin})
	req.Header.Set("Idempotency-Key", "lifecycle-retry-same-key-001")
	return req
}

// A retry with the SAME key replays the SAME transition — the command never
// executes twice, so a lost response cannot duplicate acceptance effects.
func TestHandleQuoteLifecycle_IdempotentRetryReplaysSameTransition(t *testing.T) {
	store := &quoteLifecycleIdempotentStore{stubStore: &stubStore{}, receipts: map[string]storage.IdempotencyResponse{}}
	server := &Server{Store: store}
	handler := server.RequireIdempotency("quote.accept-revision", http.HandlerFunc(server.HandleQuoteRevisionAccept))
	target := "/api/projects/" + quoteLifecycleTestProjectID + "/quote-revisions/" + quoteLifecycleTestRevID + ":accept"

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, idempotentLifecycleRequest(target))
	if w.Code != http.StatusOK {
		t.Fatalf("first accept: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if store.acceptQuoteRevisionCalls != 1 {
		t.Fatalf("expected exactly one execution, got %d", store.acceptQuoteRevisionCalls)
	}

	w = httptest.NewRecorder()
	handler.ServeHTTP(w, idempotentLifecycleRequest(target))
	if w.Code != http.StatusOK {
		t.Fatalf("retried accept: expected replayed 200, got %d: %s", w.Code, w.Body.String())
	}
	if store.acceptQuoteRevisionCalls != 1 {
		t.Fatalf("retry must replay, not re-execute: %d calls", store.acceptQuoteRevisionCalls)
	}
}
