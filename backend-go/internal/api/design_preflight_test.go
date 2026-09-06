package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #502 / WEB-DT-3: read-only authoritative preflight evaluation HTTP surface.
// The verdict comes verbatim from the storage/domain authority; the handler
// only enforces auth, permission and exact IDs.

func newPreflightRequest(claimsUserID string, roles []domain.UserRole, designID, revisionID string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/api/designs/"+designID+"/revisions/"+revisionID+"/preflight", nil)
	req.SetPathValue("designId", designID)
	req.SetPathValue("revisionId", revisionID)
	if claimsUserID != "" {
		req = withTestClaims(req, claimsUserID, roles)
	}
	return req
}

func TestHandleDesignRevisionPreflight_Unauthorized(t *testing.T) {
	server := &Server{Store: &stubStore{}}
	req := newPreflightRequest("", nil,
		"30000000-0000-4000-8000-000000000005", "40000000-0000-4000-8000-000000000007")
	w := httptest.NewRecorder()

	server.HandleDesignRevisionPreflight(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestHandleDesignRevisionPreflight_ForbiddenWithoutAccessRole(t *testing.T) {
	server := &Server{Store: &stubStore{}}
	req := newPreflightRequest("user-1", []domain.UserRole{domain.RoleUser},
		"30000000-0000-4000-8000-000000000005", "40000000-0000-4000-8000-000000000007")
	w := httptest.NewRecorder()

	server.HandleDesignRevisionPreflight(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for role without project access, got %d", w.Code)
	}
}

func TestHandleDesignRevisionPreflight_InvalidUUIDs(t *testing.T) {
	server := &Server{Store: &stubStore{}}
	w := httptest.NewRecorder()
	req := newPreflightRequest("user-1", []domain.UserRole{domain.RoleAdmin}, "not-uuid", "40000000-0000-4000-8000-000000000007")
	server.HandleDesignRevisionPreflight(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid designId, got %d", w.Code)
	}

	w = httptest.NewRecorder()
	req = newPreflightRequest("user-1", []domain.UserRole{domain.RoleAdmin}, "30000000-0000-4000-8000-000000000005", "nope")
	server.HandleDesignRevisionPreflight(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid revisionId, got %d", w.Code)
	}
}

func TestHandleDesignRevisionPreflight_NotFound(t *testing.T) {
	server := &Server{Store: &stubStore{evaluatePreflightErr: domain.ErrDesignRevisionNotFound}}
	req := newPreflightRequest("user-1", []domain.UserRole{domain.RoleAdmin},
		"30000000-0000-4000-8000-000000000005", "40000000-0000-4000-8000-000000000007")
	w := httptest.NewRecorder()

	server.HandleDesignRevisionPreflight(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for missing revision, got %d", w.Code)
	}
}

func TestHandleDesignRevisionPreflight_ReadyVerbatimForManufacturingRole(t *testing.T) {
	// Manufacturing-capability roles get the full authoritative verdict
	// verbatim (items + canonical scope).
	server := &Server{Store: &stubStore{evaluatePreflightResult: &domain.ManufacturingPreflightResult{
		DesignRevisionID: "40000000-0000-4000-8000-000000000007",
		Scope:            domain.ManufacturingPreflightScope,
		Status:           domain.ManufacturingPreflightReady,
		Items: []domain.ManufacturingPreflightItem{{
			FurnitureInstanceID:   "fi-1",
			FurnitureDefinitionID: "def-1",
			Status:                domain.ManufacturingPreflightItemOK,
		}},
	}}}
	for _, role := range []domain.UserRole{domain.RoleAdmin, domain.RoleGerenteProduccion, domain.RoleIngeniero} {
		req := newPreflightRequest("user-1", []domain.UserRole{role},
			"30000000-0000-4000-8000-000000000005", "40000000-0000-4000-8000-000000000007")
		w := httptest.NewRecorder()

		server.HandleDesignRevisionPreflight(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("role %s: expected 200, got %d", role, w.Code)
		}
		body := w.Body.String()
		for _, fragment := range []string{
			`"status":"ready"`,
			`"scope":"production-release-v1"`,
			`"includesDetail":true`,
			`"furnitureInstanceId":"fi-1"`,
		} {
			if !strings.Contains(body, fragment) {
				t.Fatalf("role %s: expected fragment %q in body %s", role, fragment, body)
			}
		}
	}
}

func TestHandleDesignRevisionPreflight_SalesRoleGetsSummaryProjection(t *testing.T) {
	// #502 permission split: sales sees the verdict, the business-safe
	// message and the blocked count — NEVER the manufacturing internals
	// (per-unit items, issue codes, definition/parameter diagnostics).
	server := &Server{Store: &stubStore{evaluatePreflightResult: &domain.ManufacturingPreflightResult{
		DesignRevisionID: "40000000-0000-4000-8000-000000000007",
		Scope:            domain.ManufacturingPreflightScope,
		Status:           domain.ManufacturingPreflightBlocked,
		Items: []domain.ManufacturingPreflightItem{{
			FurnitureInstanceID:   "fi-1",
			FurnitureDefinitionID: "def-1",
			Status:                domain.ManufacturingPreflightItemBlocked,
			Issues: []domain.ManufacturingPreflightIssue{{
				Code:    domain.PreflightIssueInvalidParameters,
				Message: "type: expected number",
			}},
		}},
		Issues: []domain.ManufacturingPreflightIssue{{
			Code:    domain.PreflightIssueInvalidParameters,
			Message: "type: expected number",
		}},
	}}}
	req := newPreflightRequest("user-1", []domain.UserRole{domain.RoleVendedor},
		"30000000-0000-4000-8000-000000000005", "40000000-0000-4000-8000-000000000007")
	w := httptest.NewRecorder()

	server.HandleDesignRevisionPreflight(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	body := w.Body.String()
	for _, fragment := range []string{
		`"status":"blocked"`,
		`"includesDetail":false`,
		`"blockedItemCount":1`,
	} {
		if !strings.Contains(body, fragment) {
			t.Fatalf("expected fragment %q in body %s", fragment, body)
		}
	}
	for _, leaked := range []string{"fi-1", "invalid_parameters", "furnitureDefinitionId", "parameter"} {
		if strings.Contains(body, leaked) {
			t.Fatalf("sales projection must not leak manufacturing detail %q in body %s", leaked, body)
		}
	}
}

func TestHandleDesignRevisionPreflight_BlockedIssuesEchoed(t *testing.T) {
	server := &Server{Store: &stubStore{evaluatePreflightResult: &domain.ManufacturingPreflightResult{
		DesignRevisionID: "40000000-0000-4000-8000-000000000007",
		Scope:            domain.ManufacturingPreflightScope,
		Status:           domain.ManufacturingPreflightBlocked,
		Items:            []domain.ManufacturingPreflightItem{},
		Issues: []domain.ManufacturingPreflightIssue{{
			Code:    domain.PreflightIssueEmptyRevision,
			Message: "the design revision carries no furniture to manufacture",
		}},
	}}}
	req := newPreflightRequest("user-1", []domain.UserRole{domain.RoleAdmin},
		"30000000-0000-4000-8000-000000000005", "40000000-0000-4000-8000-000000000007")
	w := httptest.NewRecorder()

	server.HandleDesignRevisionPreflight(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("blocked preflight is still a 200 read result (the gate lives in the release command), got %d", w.Code)
	}
	body := w.Body.String()
	if !strings.Contains(body, `"status":"blocked"`) || !strings.Contains(body, `"code":"empty_revision"`) {
		t.Fatalf("expected blocked status + canonical issue code in body %s", body)
	}
	if !strings.Contains(body, `"includesDetail":true`) {
		t.Fatalf("admin must receive the manufacturing detail projection")
	}
}

func TestHandleDesignRevisionApproveForProduction_RequiresAndForwardsExactPin(t *testing.T) {
	// #502 production approval: the exact quote pin is REQUIRED — there is no
	// body-less mode — and travels verbatim to the always-gated command.
	stub := &stubStore{}
	server := &Server{Store: stub}
	projectID := "11111111-0000-4000-8000-000000000001"
	designID := "30000000-0000-4000-8000-000000000005"
	revisionID := "40000000-0000-4000-8000-000000000007"
	quoteID := "aaaaaaa1-0000-4000-8000-000000000001"

	newReq := func(body string) *http.Request {
		var reader *bytes.Reader
		if body == "" {
			reader = bytes.NewReader(nil)
		} else {
			reader = bytes.NewReader([]byte(body))
		}
		req := httptest.NewRequest(http.MethodPost,
			"/api/projects/"+projectID+"/designs/"+designID+"/revisions/"+revisionID+":approve-for-production",
			reader)
		req.SetPathValue("projectId", projectID)
		req.SetPathValue("designId", designID)
		req.SetPathValue("revisionId", revisionID)
		return withTestClaims(req, "user-1", []domain.UserRole{domain.RoleAdmin})
	}

	// Exact pin forwarded verbatim.
	w := httptest.NewRecorder()
	server.HandleProjectDesignRevisionApproveForProduction(w, newReq(`{"quoteRevisionId":"`+quoteID+`"}`))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if stub.approveForProductionCmd == nil || stub.approveForProductionCmd.QuoteRevisionID != quoteID ||
		stub.approveForProductionCmd.ProjectID != projectID {
		t.Fatalf("exact quote pin + project must be forwarded to the command, got %+v", stub.approveForProductionCmd)
	}

	// Missing body / empty pin: NO skip mode — 400 before any store call.
	before := stub.approveForProductionCalls
	w = httptest.NewRecorder()
	server.HandleProjectDesignRevisionApproveForProduction(w, newReq(``))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("body-less production approval must reject 400, got %d", w.Code)
	}
	if stub.approveForProductionCalls != before {
		t.Fatalf("invalid pin must not reach the store")
	}

	// Invalid pin UUID rejects 400.
	w = httptest.NewRecorder()
	server.HandleProjectDesignRevisionApproveForProduction(w, newReq(`{"quoteRevisionId":"nope"}`))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("invalid quoteRevisionId must 400, got %d", w.Code)
	}

	// Read-only roles cannot call the production approval at all.
	vendedorReq := httptest.NewRequest(http.MethodPost,
		"/api/projects/"+projectID+"/designs/"+designID+"/revisions/"+revisionID+":approve-for-production",
		bytes.NewBufferString(`{"quoteRevisionId":"`+quoteID+`"}`))
	vendedorReq.SetPathValue("projectId", projectID)
	vendedorReq.SetPathValue("designId", designID)
	vendedorReq.SetPathValue("revisionId", revisionID)
	vendedorReq = withTestClaims(vendedorReq, "user-1", []domain.UserRole{domain.RoleVendedor})
	w = httptest.NewRecorder()
	server.HandleProjectDesignRevisionApproveForProduction(w, vendedorReq)
	if w.Code != http.StatusForbidden {
		t.Fatalf("vendedor must not approve for production, got %d", w.Code)
	}
}

func TestHandleDesignRevisionPreflight_ExactIDsForwarded(t *testing.T) {
	stub := &stubStore{}
	server := &Server{Store: stub}
	designID := "30000000-0000-4000-8000-000000000005"
	revisionID := "40000000-0000-4000-8000-000000000007"
	req := newPreflightRequest("user-1", []domain.UserRole{domain.RoleAdmin}, designID, revisionID)
	w := httptest.NewRecorder()

	server.HandleDesignRevisionPreflight(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if stub.evaluatePreflightDesignID != designID || stub.evaluatePreflightRevisionID != revisionID {
		t.Fatalf("exact design/revision IDs must be forwarded verbatim, got %q/%q", stub.evaluatePreflightDesignID, stub.evaluatePreflightRevisionID)
	}
	if stub.evaluatePreflightCalls != 1 {
		t.Fatalf("expected exactly one store evaluation, got %d", stub.evaluatePreflightCalls)
	}
}
