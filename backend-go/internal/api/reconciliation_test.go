package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func withTestClaims(req *http.Request, userID string, roles []domain.UserRole) *http.Request {
	roleStrs := make([]string, len(roles))
	primaryRole := ""
	for i, r := range roles {
		roleStrs[i] = string(r)
		if i == 0 {
			primaryRole = string(r)
		}
	}
	claims := &auth.Claims{
		UserID: userID,
		Email:  userID + "@test.com",
		Role:   primaryRole,
		Roles:  roleStrs,
		OrgID:  storage.InitialOrganizationID,
	}
	ctx := context.WithValue(req.Context(), UserContextKey, claims)
	ctx = storage.WithOrgCtx(ctx, storage.InitialOrganizationID)
	return req.WithContext(ctx)
}


func TestHandleProjectReconciliation_Unauthorized(t *testing.T) {
	server := &Server{Store: &stubStore{}}
	req := httptest.NewRequest(http.MethodPost, "/api/projects/10000000-0000-0000-0000-000000000001/reconciliation", bytes.NewBufferString("{}"))
	w := httptest.NewRecorder()

	server.HandleProjectReconciliation(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized, got %d", w.Code)
	}
}

func TestHandleProjectReconciliation_Forbidden(t *testing.T) {
	server := &Server{Store: &stubStore{}}
	req := httptest.NewRequest(http.MethodPost, "/api/projects/10000000-0000-0000-0000-000000000001/reconciliation", bytes.NewBufferString("{}"))
	// role with no project access
	req = withTestClaims(req, "user-1", []domain.UserRole{"unrelated_role"})
	w := httptest.NewRecorder()

	server.HandleProjectReconciliation(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden, got %d", w.Code)
	}
}

func TestHandleProjectReconciliation_InvalidUUID(t *testing.T) {
	server := &Server{Store: &stubStore{}}

	// Bad project ID
	req := httptest.NewRequest(http.MethodPost, "/api/projects/invalid-uuid/reconciliation", bytes.NewBufferString(`{"quoteRevisionId":"20000000-0000-0000-0000-000000000001","designRevisionId":"30000000-0000-0000-0000-000000000001"}`))
	req.SetPathValue("projectId", "invalid-uuid")
	req = withTestClaims(req, "user-1", []domain.UserRole{domain.RoleAdmin})
	w := httptest.NewRecorder()

	server.HandleProjectReconciliation(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for invalid project UUID, got %d", w.Code)
	}

	// Bad quote/design revision UUID
	req2 := httptest.NewRequest(http.MethodPost, "/api/projects/10000000-0000-0000-0000-000000000001/reconciliation", bytes.NewBufferString(`{"quoteRevisionId":"not-uuid","designRevisionId":"30000000-0000-0000-0000-000000000001"}`))
	req2.SetPathValue("projectId", "10000000-0000-0000-0000-000000000001")
	req2 = withTestClaims(req2, "user-1", []domain.UserRole{domain.RoleAdmin})
	w2 := httptest.NewRecorder()

	server.HandleProjectReconciliation(w2, req2)
	if w2.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for invalid revision UUID, got %d", w2.Code)
	}
}

func TestHandleProjectReconciliation_CrossProjectRejected(t *testing.T) {
	store := &stubStore{
		reconcileProjectErr: domain.ErrCrossProjectReconciliation,
	}
	server := &Server{Store: store}

	body := `{"quoteRevisionId":"20000000-0000-0000-0000-000000000001","designRevisionId":"30000000-0000-0000-0000-000000000001"}`
	req := httptest.NewRequest(http.MethodPost, "/api/projects/10000000-0000-0000-0000-000000000001/reconciliation", bytes.NewBufferString(body))
	req.SetPathValue("projectId", "10000000-0000-0000-0000-000000000001")
	req = withTestClaims(req, "user-1", []domain.UserRole{domain.RoleAdmin})
	w := httptest.NewRecorder()

	server.HandleProjectReconciliation(w, req)

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict for cross-project reconciliation, got %d", w.Code)
	}

	var errResp openapi.ApiError
	if err := json.NewDecoder(w.Body).Decode(&errResp); err != nil {
		t.Fatalf("failed to decode error response: %v", err)
	}
	if errResp.Code != openapi.ApiErrorCodeConflict {
		t.Fatalf("expected ApiErrorCodeConflict, got %s", errResp.Code)
	}
}

func TestHandleProjectReconciliation_NotFound(t *testing.T) {
	// Project not found
	storeProjNotFound := &stubStore{reconcileProjectErr: domain.ErrDesignNotFound}
	server1 := &Server{Store: storeProjNotFound}

	req1 := httptest.NewRequest(http.MethodPost, "/api/projects/10000000-0000-0000-0000-000000000001/reconciliation", bytes.NewBufferString(`{"quoteRevisionId":"20000000-0000-0000-0000-000000000001","designRevisionId":"30000000-0000-0000-0000-000000000001"}`))
	req1.SetPathValue("projectId", "10000000-0000-0000-0000-000000000001")
	req1 = withTestClaims(req1, "user-1", []domain.UserRole{domain.RoleAdmin})
	w1 := httptest.NewRecorder()
	server1.HandleProjectReconciliation(w1, req1)
	if w1.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for project not found, got %d", w1.Code)
	}

	// DesignRevision not found
	storeRevNotFound := &stubStore{reconcileProjectErr: domain.ErrDesignRevisionNotFound}
	server2 := &Server{Store: storeRevNotFound}

	req2 := httptest.NewRequest(http.MethodPost, "/api/projects/10000000-0000-0000-0000-000000000001/reconciliation", bytes.NewBufferString(`{"quoteRevisionId":"20000000-0000-0000-0000-000000000001","designRevisionId":"30000000-0000-0000-0000-000000000001"}`))
	req2.SetPathValue("projectId", "10000000-0000-0000-0000-000000000001")
	req2 = withTestClaims(req2, "user-1", []domain.UserRole{domain.RoleAdmin})
	w2 := httptest.NewRecorder()
	server2.HandleProjectReconciliation(w2, req2)
	if w2.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for design revision not found, got %d", w2.Code)
	}
}

func TestHandleProjectReconciliation_Success(t *testing.T) {
	projID := "10000000-0000-0000-0000-000000000001"
	quoteRevID := "20000000-0000-0000-0000-000000000001"
	designRevID := "30000000-0000-0000-0000-000000000001"

	store := &stubStore{
		reconcileProjectResult: &domain.ReconciliationResult{
			ProjectID:        projID,
			QuoteRevisionID:  quoteRevID,
			DesignRevisionID: designRevID,
			Summary: domain.ReconciliationSummary{
				Total:            2,
				Synced:           1,
				QuotedNotModeled: 0,
				ModeledNotQuoted: 0,
				Modified:         1,
				Removed:          0,
				Conflict:         0,
			},
			Items: []domain.ReconciliationItem{
				{
					FurnitureInstanceID: "FI-001",
					Status:              domain.ReconciliationStatusSynced,
					Differences:         []domain.StructuredDifference{},
				},
				{
					FurnitureInstanceID: "FI-002",
					Status:              domain.ReconciliationStatusModified,
					Differences: []domain.StructuredDifference{
						{
							Path:        "parameters.widthMm",
							QuoteValue:  int64(600),
							DesignValue: int64(650),
						},
					},
				},
			},
		},
	}
	server := &Server{Store: store}

	// Test with camelCase payload
	body := `{"quoteRevisionId":"` + quoteRevID + `","designRevisionId":"` + designRevID + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/projects/"+projID+"/reconciliation", bytes.NewBufferString(body))
	req.SetPathValue("projectId", projID)
	req = withTestClaims(req, "user-1", []domain.UserRole{domain.RoleVendedor})
	w := httptest.NewRecorder()

	server.HandleProjectReconciliation(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	var resp openapi.ProjectDesignReconciliationResult
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.ProjectId != projID {
		t.Errorf("expected projectId %s, got %s", projID, resp.ProjectId)
	}
	if resp.QuoteRevisionId != quoteRevID {
		t.Errorf("expected quoteRevisionId %s, got %s", quoteRevID, resp.QuoteRevisionId)
	}
	if resp.DesignRevisionId != designRevID {
		t.Errorf("expected designRevisionId %s, got %s", designRevID, resp.DesignRevisionId)
	}
	if resp.Summary.Total != 2 || resp.Summary.Synced != 1 || resp.Summary.Modified != 1 {
		t.Errorf("unexpected summary: %+v", resp.Summary)
	}
	if len(resp.Items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(resp.Items))
	}
	if resp.Items[1].Status != openapi.ReconciliationStatus("modified") {
		t.Errorf("expected modified item, got %s", resp.Items[1].Status)
	}
	if len(resp.Items[1].Differences) != 1 || resp.Items[1].Differences[0].Path != "parameters.widthMm" {
		t.Errorf("unexpected differences: %+v", resp.Items[1].Differences)
	}

	// Test with snake_case payload compatibility
	bodySnake := `{"quote_revision_id":"` + quoteRevID + `","design_revision_id":"` + designRevID + `"}`
	reqSnake := httptest.NewRequest(http.MethodPost, "/api/projects/"+projID+"/reconciliation", bytes.NewBufferString(bodySnake))
	reqSnake.SetPathValue("projectId", projID)
	reqSnake = withTestClaims(reqSnake, "user-1", []domain.UserRole{domain.RoleVendedor})
	wSnake := httptest.NewRecorder()

	server.HandleProjectReconciliation(wSnake, reqSnake)
	if wSnake.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for snake_case payload, got %d: %s", wSnake.Code, wSnake.Body.String())
	}
}
