package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #394 / DT-10: explicit requote HTTP surface.

const (
	requoteTestProjectID = "10000000-0000-0000-0000-000000000001"
	requoteTestBaseRevID = "20000000-0000-0000-0000-000000000003"
	requoteTestDesignID  = "30000000-0000-0000-0000-000000000005"
)

func newRequoteRequest(claimsUserID string, roles []domain.UserRole, body string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/api/projects/"+requoteTestProjectID+"/quote-revisions:requote", bytes.NewBufferString(body))
	req.SetPathValue("projectId", requoteTestProjectID)
	if claimsUserID != "" {
		req = withTestClaims(req, claimsUserID, roles)
	}
	return req
}

func TestHandleProjectQuoteRequote_Unauthorized(t *testing.T) {
	server := &Server{Store: &stubStore{}}
	req := newRequoteRequest("", nil, `{}`)
	w := httptest.NewRecorder()

	server.HandleProjectQuoteRequote(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestHandleProjectQuoteRequote_ForbiddenWithoutMutateRole(t *testing.T) {
	// producción can view projects but commercial revisions are a
	// sales-side mutation (quote:edit semantics, digital-thread §22).
	server := &Server{Store: &stubStore{}}
	body := `{"baseQuoteRevisionId":"` + requoteTestBaseRevID + `","designRevisionId":"` + requoteTestDesignID + `"}`
	req := newRequoteRequest("user-1", []domain.UserRole{domain.RoleProduccion}, body)
	w := httptest.NewRecorder()

	server.HandleProjectQuoteRequote(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for read-only role, got %d", w.Code)
	}
}

func TestHandleProjectQuoteRequote_InvalidUUIDs(t *testing.T) {
	server := &Server{Store: &stubStore{}}
	validBody := `{"baseQuoteRevisionId":"` + requoteTestBaseRevID + `","designRevisionId":"` + requoteTestDesignID + `"}`

	// invalid project
	req := httptest.NewRequest(http.MethodPost, "/api/projects/not-uuid/quote-revisions:requote", bytes.NewBufferString(validBody))
	req.SetPathValue("projectId", "not-uuid")
	req = withTestClaims(req, "user-1", []domain.UserRole{domain.RoleAdmin})
	w := httptest.NewRecorder()
	server.HandleProjectQuoteRequote(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid projectId, got %d", w.Code)
	}

	// invalid revision IDs
	req = newRequoteRequest("user-1", []domain.UserRole{domain.RoleAdmin}, `{"baseQuoteRevisionId":"nope","designRevisionId":"`+requoteTestDesignID+`"}`)
	w = httptest.NewRecorder()
	server.HandleProjectQuoteRequote(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid baseQuoteRevisionId, got %d", w.Code)
	}

	// invalid selection entry
	req = newRequoteRequest("user-1", []domain.UserRole{domain.RoleAdmin}, `{"baseQuoteRevisionId":"`+requoteTestBaseRevID+`","designRevisionId":"`+requoteTestDesignID+`","includeFurnitureInstanceIds":["not-uuid"]}`)
	w = httptest.NewRecorder()
	server.HandleProjectQuoteRequote(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid includeFurnitureInstanceIds, got %d", w.Code)
	}
}

func TestHandleProjectQuoteRequote_Success(t *testing.T) {
	store := &stubStore{}
	server := &Server{Store: store}
	body := `{"baseQuoteRevisionId":"` + requoteTestBaseRevID + `","designRevisionId":"` + requoteTestDesignID + `"}`
	req := newRequoteRequest("user-1", []domain.UserRole{domain.RoleAdmin}, body)
	w := httptest.NewRecorder()

	server.HandleProjectQuoteRequote(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", w.Code, w.Body.String())
	}
	if store.requoteProjectQuoteCalls != 1 {
		t.Fatalf("expected exactly one store call, got %d", store.requoteProjectQuoteCalls)
	}
	cmd := store.requoteProjectQuoteCmd
	if cmd == nil || cmd.ProjectID != requoteTestProjectID || cmd.BaseQuoteRevisionID != requoteTestBaseRevID || cmd.DesignRevisionID != requoteTestDesignID {
		t.Fatalf("command not forwarded verbatim: %+v", cmd)
	}

	var result openapi.ProjectQuoteRequoteResult
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if result.QuoteRevision.Status != openapi.QuoteRevisionStatusDraft {
		t.Errorf("created revision status = %s, want draft", result.QuoteRevision.Status)
	}
	if result.QuoteRevision.SourceType != openapi.QuoteRevisionSourceTypeRequote {
		t.Errorf("created revision sourceType = %s, want requote", result.QuoteRevision.SourceType)
	}
	if result.QuoteRevision.BaseQuoteRevisionId == nil || *result.QuoteRevision.BaseQuoteRevisionId != requoteTestBaseRevID {
		t.Errorf("created revision must carry baseQuoteRevisionId provenance")
	}
	if result.QuoteRevision.SourceDesignRevisionId == nil || *result.QuoteRevision.SourceDesignRevisionId != requoteTestDesignID {
		t.Errorf("created revision must carry sourceDesignRevisionId provenance")
	}
	if !result.Impact.RequiresRequote {
		t.Errorf("response must include the classification summary that justified the requote")
	}
}

func TestHandleProjectQuoteRequote_SelectionForwarded(t *testing.T) {
	store := &stubStore{}
	server := &Server{Store: store}
	body := `{"baseQuoteRevisionId":"` + requoteTestBaseRevID + `","designRevisionId":"` + requoteTestDesignID + `","includeFurnitureInstanceIds":["a0000000-0000-4000-8000-000000000002"]}`
	req := newRequoteRequest("user-1", []domain.UserRole{domain.RoleAdmin}, body)
	w := httptest.NewRecorder()

	server.HandleProjectQuoteRequote(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	if cmd := store.requoteProjectQuoteCmd; cmd == nil || len(cmd.IncludeFurnitureInstanceIDs) != 1 {
		t.Fatalf("selection not forwarded: %+v", store.requoteProjectQuoteCmd)
	}
}

func TestHandleProjectQuoteRequote_ErrorMapping(t *testing.T) {
	cases := []struct {
		name string
		err  error
		code int
	}{
		{"conflict blocks requote", domain.ErrRequoteBlockedByConflict, http.StatusConflict},
		{"no commercial change", domain.ErrRequoteNoCommercialChange, http.StatusConflict},
		{"stale base revision", domain.ErrQuoteRevisionConflict, http.StatusConflict},
		{"corrupt snapshot", domain.ErrInvalidRevisionSnapshot, http.StatusConflict},
		{"quote revision not found", domain.ErrQuoteRevisionNotFound, http.StatusNotFound},
		{"design revision not found", domain.ErrDesignRevisionNotFound, http.StatusNotFound},
		{"project not found", domain.ErrDesignNotFound, http.StatusNotFound},
		{"cross-project", domain.ErrCrossProjectReconciliation, http.StatusConflict},
		{"foreign owner organization", domain.ErrFurnitureInstanceProjectNotWritable, http.StatusForbidden},
		{"invalid revision id", domain.ErrInvalidRevisionID, http.StatusBadRequest},
	}
	body := `{"baseQuoteRevisionId":"` + requoteTestBaseRevID + `","designRevisionId":"` + requoteTestDesignID + `"}`
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := &stubStore{requoteProjectQuoteErr: tc.err}
			server := &Server{Store: store}
			req := newRequoteRequest("user-1", []domain.UserRole{domain.RoleAdmin}, body)
			w := httptest.NewRecorder()

			server.HandleProjectQuoteRequote(w, req)
			if w.Code != tc.code {
				t.Fatalf("expected %d for %v, got %d: %s", tc.code, tc.err, w.Code, w.Body.String())
			}
		})
	}
}
