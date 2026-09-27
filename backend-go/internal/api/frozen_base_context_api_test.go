package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestFrozenBaseContextHTTPConflictAcrossCommands(t *testing.T) {
	for _, tc := range []struct {
		name  string
		cause string
		err   error
	}{
		{"missing", domain.FrozenBaseContextMissingCause, &domain.FrozenBaseContextError{
			FurnitureInstanceID: releaseTestInstanceID, Cause: domain.FrozenBaseContextMissingCause,
		}},
		{"malformed", domain.FrozenBaseContextInvalidCause, &domain.FrozenBaseContextError{
			FurnitureInstanceID: releaseTestInstanceID, Cause: domain.FrozenBaseContextInvalidCause,
		}},
	} {
		for _, command := range []string{"preflight", "approval", "release"} {
			t.Run(tc.name+"/"+command, func(t *testing.T) {
				store := &stubStore{
					evaluatePreflightErr:       tc.err,
					approveForProductionErr:    tc.err,
					createProductionReleaseErr: tc.err,
				}
				server := &Server{Store: store}
				var req *http.Request
				var handler http.HandlerFunc
				switch command {
				case "preflight":
					req = newPreflightRequest("user-1", []domain.UserRole{domain.RoleAdmin}, releaseTestDesignID, releaseTestRevisionID)
					req.Body = http.NoBody
					handler = server.HandleDesignRevisionPreflight
				case "approval":
					req = httptest.NewRequest(http.MethodPost, "/api/projects/"+releaseTestProjectID+"/designs/"+releaseTestDesignID+"/revisions/"+releaseTestRevisionID+":approve-for-production", bytes.NewBufferString(`{"quoteRevisionId":"`+releaseTestQuoteRevID+`"}`))
					req.SetPathValue("projectId", releaseTestProjectID)
					req.SetPathValue("designId", releaseTestDesignID)
					req.SetPathValue("revisionId", releaseTestRevisionID)
					req = withTestClaims(req, "user-1", []domain.UserRole{domain.RoleAdmin})
					handler = server.HandleProjectDesignRevisionApproveForProduction
				case "release":
					req = httptest.NewRequest(http.MethodPost, "/api/projects/"+releaseTestProjectID+"/production-releases", bytes.NewBufferString(`{"design_revision_id":"`+releaseTestRevisionID+`","quote_revision_id":"`+releaseTestQuoteRevID+`"}`))
					req.SetPathValue("projectId", releaseTestProjectID)
					req = withTestClaims(req, "user-1", []domain.UserRole{domain.RoleAdmin})
					handler = server.HandleProjectProductionReleases
				}
				w := httptest.NewRecorder()
				handler(w, req)
				if w.Code != http.StatusConflict {
					t.Fatalf("expected actionable 409, got %d: %s", w.Code, w.Body.String())
				}
				var response struct {
					Details map[string]any `json:"details"`
				}
				if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
					t.Fatal(err)
				}
				if response.Details["blocker"] != tc.cause || response.Details["furnitureInstanceId"] != releaseTestInstanceID {
					t.Fatalf("lost typed cause or identity: %+v", response.Details)
				}
				if !strings.Contains(w.Body.String(), domain.FrozenBaseContextUserMessage) {
					t.Fatalf("missing safe correction message: %s", w.Body.String())
				}
			})
		}
	}
}

func TestQuotedPreflightFrozenVerdictIsActionableConflict(t *testing.T) {
	server := &Server{Store: &stubStore{evaluatePreflightResult: &domain.ManufacturingPreflightResult{
		DesignRevisionID: releaseTestRevisionID,
		Scope:            domain.ManufacturingPreflightScope,
		Status:           domain.ManufacturingPreflightBlocked,
		Issues: []domain.ManufacturingPreflightIssue{{
			Code:                domain.PreflightIssueFrozenBaseContext,
			FurnitureInstanceID: releaseTestInstanceID,
			Message:             domain.FrozenBaseContextUserMessage,
		}},
	}}}
	req := newPreflightRequest("user-1", []domain.UserRole{domain.RoleAdmin}, releaseTestDesignID, releaseTestRevisionID)
	req.Body = io.NopCloser(strings.NewReader(`{"quoteRevisionId":"` + releaseTestQuoteRevID + `"}`))
	w := httptest.NewRecorder()
	server.HandleDesignRevisionPreflight(w, req)
	if w.Code != http.StatusConflict {
		t.Fatalf("frozen quoted preflight must return 409, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"blocker":"frozen_base_context"`) {
		t.Fatalf("lost structured frozen blocker: %s", w.Body.String())
	}
}
