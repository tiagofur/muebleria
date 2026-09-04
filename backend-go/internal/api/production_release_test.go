package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #395 / DT-11 handler proofs: permission separation (approve vs release vs
// plain editor), server-side verdict mapping, readback shape and the durable
// idempotency semantics of both commands.

const (
	releaseTestProjectID  = "3f0c9c11-0000-4000-8000-000000000001"
	releaseTestDesignID   = "3f0c9c11-0000-4000-8000-000000000002"
	releaseTestRevisionID = "3f0c9c11-0000-4000-8000-000000000003"
	releaseTestQuoteRevID = "3f0c9c11-0000-4000-8000-000000000004"
	releaseTestReleaseID  = "3f0c9c11-0000-4000-8000-000000000005"
)

func newApproveRequest(userID string, roles []domain.UserRole) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/api/designs/"+releaseTestDesignID+"/revisions/"+releaseTestRevisionID+":approve", nil)
	req.SetPathValue("designId", releaseTestDesignID)
	req.SetPathValue("revisionId", releaseTestRevisionID)
	req = withTestClaims(req, userID, roles)
	req.Header.Set("Idempotency-Key", "approve-key-000000000001")
	return req
}

func TestHandleDesignRevisionApprove_HappyPath(t *testing.T) {
	store := &stubStore{}
	server := &Server{Store: store}
	w := httptest.NewRecorder()
	server.HandleDesignRevisionApprove(w, newApproveRequest("user-approve", []domain.UserRole{domain.RoleIngeniero}))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if store.approveDesignRevisionCalls != 1 {
		t.Fatalf("approval must reach the store exactly once")
	}
	if store.approveDesignRevisionCmd.ActorUserID != "user-approve" {
		t.Fatalf("actor must come from the session claims, not the body")
	}
	var rev struct {
		Status     string  `json:"status"`
		ApprovedBy *string `json:"approved_by"`
		ApprovedAt *string `json:"approved_at"`
	}
	if err := json.NewDecoder(w.Body).Decode(&rev); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if rev.Status != "approved" || rev.ApprovedBy == nil || rev.ApprovedAt == nil {
		t.Fatalf("readback must expose the approval metadata: %+v", rev)
	}
}

func TestHandleDesignRevisionApprove_PermissionDenial(t *testing.T) {
	// Vendedor publishes (RoleCanMutateProjects) but must NOT approve; a
	// plain user must not either. UI hiding is not security — the server
	// enforces the capability split (#395 §37).
	for _, roles := range [][]domain.UserRole{
		{domain.RoleVendedor},
		{domain.RoleUser},
		{domain.RoleProduccion},
	} {
		server := &Server{Store: &stubStore{}}
		w := httptest.NewRecorder()
		server.HandleDesignRevisionApprove(w, newApproveRequest("user-1", roles))
		if w.Code != http.StatusForbidden {
			t.Fatalf("roles %v: expected 403, got %d", roles, w.Code)
		}
	}
	// The explicit approvers pass.
	for _, role := range []domain.UserRole{domain.RoleAdmin, domain.RoleGerenteVentas, domain.RoleIngeniero} {
		server := &Server{Store: &stubStore{}}
		w := httptest.NewRecorder()
		server.HandleDesignRevisionApprove(w, newApproveRequest("user-1", []domain.UserRole{role}))
		if w.Code != http.StatusOK {
			t.Fatalf("role %s: expected 200, got %d", role, w.Code)
		}
	}
}

func TestHandleDesignRevisionApprove_ErrorMapping(t *testing.T) {
	cases := []struct {
		name string
		err  error
		code int
	}{
		{"revision not found", domain.ErrDesignRevisionNotFound, http.StatusNotFound},
		{"invalid command", domain.ErrInvalidDesignCommand, http.StatusBadRequest},
		{"invalid transition (superseded)", domain.ErrDesignRevisionApprovalInvalid, http.StatusConflict},
	}
	for _, tc := range cases {
		store := &stubStore{approveDesignRevisionErr: tc.err}
		server := &Server{Store: store}
		w := httptest.NewRecorder()
		server.HandleDesignRevisionApprove(w, newApproveRequest("user-1", []domain.UserRole{domain.RoleAdmin}))
		if w.Code != tc.code {
			t.Fatalf("%s: expected %d, got %d: %s", tc.name, tc.code, w.Code, w.Body.String())
		}
	}
}

func TestHandleProjectProductionReleases_CreateHappyPath(t *testing.T) {
	store := &stubStore{}
	server := &Server{Store: store}
	body := `{"design_revision_id":"` + releaseTestRevisionID + `","quote_revision_id":"` + releaseTestQuoteRevID + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/projects/"+releaseTestProjectID+"/production-releases", bytes.NewBufferString(body))
	req.SetPathValue("projectId", releaseTestProjectID)
	req = withTestClaims(req, "user-release", []domain.UserRole{domain.RoleGerenteProduccion})
	w := httptest.NewRecorder()
	server.HandleProjectProductionReleases(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	if store.createProductionReleaseCalls != 1 {
		t.Fatalf("release must reach the store exactly once")
	}
	cmd := store.createProductionReleaseCmd
	if cmd == nil || cmd.DesignRevisionID != releaseTestRevisionID || cmd.QuoteRevisionID != releaseTestQuoteRevID {
		t.Fatalf("exact revision pins must travel to the command: %+v", cmd)
	}
	if cmd.ActorUserID != "user-release" {
		t.Fatalf("actor must come from the session claims (no client release authority)")
	}

	var release map[string]any
	if err := json.NewDecoder(w.Body).Decode(&release); err != nil {
		t.Fatalf("decode: %v", err)
	}
	for _, field := range []string{"id", "project_id", "design_revision_id", "design_revision_number", "manufacturing_fingerprint", "status", "released_by", "released_at", "staleness", "release_number"} {
		if _, ok := release[field]; !ok {
			t.Fatalf("readback must expose %q (#395 §34): %v", field, release)
		}
	}
	if release["design_revision_id"] != releaseTestRevisionID {
		t.Fatalf("release must pin the exact design revision")
	}
}

func TestHandleProjectProductionReleases_CreatePermissionDenial(t *testing.T) {
	// The design approver (gerente_ventas) cannot release; the sales editor
	// (vendedor) can neither approve nor release. Distinct capabilities,
	// least privilege (#395 §37).
	for _, roles := range [][]domain.UserRole{
		{domain.RoleVendedor},
		{domain.RoleGerenteVentas},
		{domain.RoleUser},
		{domain.RoleAlmacen},
	} {
		server := &Server{Store: &stubStore{}}
		req := httptest.NewRequest(http.MethodPost, "/api/projects/"+releaseTestProjectID+"/production-releases", bytes.NewBufferString(`{"design_revision_id":"`+releaseTestRevisionID+`"}`))
		req.SetPathValue("projectId", releaseTestProjectID)
		req = withTestClaims(req, "user-1", roles)
		w := httptest.NewRecorder()
		server.HandleProjectProductionReleases(w, req)
		if w.Code != http.StatusForbidden {
			t.Fatalf("roles %v: expected 403, got %d", roles, w.Code)
		}
	}
	for _, role := range []domain.UserRole{domain.RoleAdmin, domain.RoleGerenteProduccion, domain.RoleIngeniero} {
		server := &Server{Store: &stubStore{}}
		req := httptest.NewRequest(http.MethodPost, "/api/projects/"+releaseTestProjectID+"/production-releases", bytes.NewBufferString(`{"design_revision_id":"`+releaseTestRevisionID+`"}`))
		req.SetPathValue("projectId", releaseTestProjectID)
		req = withTestClaims(req, "user-1", []domain.UserRole{role})
		w := httptest.NewRecorder()
		server.HandleProjectProductionReleases(w, req)
		if w.Code != http.StatusCreated {
			t.Fatalf("role %s: expected 201, got %d: %s", role, w.Code, w.Body.String())
		}
	}
}

func TestHandleProjectProductionReleases_GateErrorMapping(t *testing.T) {
	blockedPreflight := &domain.ReleasePreflightBlockedError{Result: domain.RunManufacturingPreflight(
		releaseTestRevisionID, nil, nil)} // empty revision → blocked
	conflictClassification := &domain.ImpactClassificationResult{
		Summary: domain.ImpactClassificationSummary{RequiresResolution: true},
	}
	outdatedClassification := &domain.ImpactClassificationResult{
		Summary: domain.ImpactClassificationSummary{RequiresRequote: true, CommercialChanges: 2},
	}

	cases := []struct {
		name     string
		err      error
		code     int
		detailOn string
	}{
		{"unapproved revision", domain.ErrDesignRevisionNotApproved, http.StatusConflict, ""},
		{"quote not accepted", domain.ErrReleaseQuoteNotAccepted, http.StatusConflict, ""},
		{"preflight blocked", blockedPreflight, http.StatusConflict, "issues"},
		{"reconciliation conflict", &domain.ReleaseCommercialGateError{Classification: conflictClassification, Cause: domain.ReleaseBlockerReconciliationConflict}, http.StatusConflict, "blocker"},
		{"commercial outdated", &domain.ReleaseCommercialGateError{Classification: outdatedClassification, Cause: domain.ReleaseBlockerCommercialOutdated}, http.StatusConflict, "requiresRequote"},
		{"cross project", domain.ErrCrossProjectRelease, http.StatusNotFound, ""},
		{"quote revision not found", domain.ErrQuoteRevisionNotFound, http.StatusNotFound, ""},
		{"design revision not found", domain.ErrDesignRevisionNotFound, http.StatusNotFound, ""},
		{"invalid command", domain.ErrInvalidReleaseCommand, http.StatusBadRequest, ""},
	}
	for _, tc := range cases {
		store := &stubStore{createProductionReleaseErr: tc.err}
		server := &Server{Store: store}
		req := httptest.NewRequest(http.MethodPost, "/api/projects/"+releaseTestProjectID+"/production-releases", bytes.NewBufferString(`{"design_revision_id":"`+releaseTestRevisionID+`"}`))
		req.SetPathValue("projectId", releaseTestProjectID)
		req = withTestClaims(req, "user-1", []domain.UserRole{domain.RoleAdmin})
		w := httptest.NewRecorder()
		server.HandleProjectProductionReleases(w, req)
		if w.Code != tc.code {
			t.Fatalf("%s: expected %d, got %d: %s", tc.name, tc.code, w.Code, w.Body.String())
		}
		if tc.detailOn != "" {
			var apiErr struct {
				Details map[string]any `json:"details"`
			}
			if err := json.NewDecoder(w.Body).Decode(&apiErr); err != nil {
				t.Fatalf("%s: decode error body: %v", tc.name, err)
			}
			if _, ok := apiErr.Details[tc.detailOn]; !ok {
				t.Fatalf("%s: expected details.%s to carry the authoritative blocker: %v", tc.name, tc.detailOn, apiErr.Details)
			}
		}
	}
}

func TestHandleProjectProductionReleases_ListAndGet(t *testing.T) {
	store := &stubStore{
		listProductionReleasesResult: []storage.ProductionReleaseReadback{
			{
				Release: domain.ProductionRelease{
					ID:                       releaseTestReleaseID,
					ProjectID:                releaseTestProjectID,
					DesignRevisionID:         releaseTestRevisionID,
					ReleaseNumber:            2,
					DesignRevisionNumber:     3,
					ManufacturingFingerprint: "sha256-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
					Status:                   domain.ProductionReleaseStatusActive,
					ReleasedBy:               "user-release",
				},
				Staleness: domain.ProductionReleaseStaleness{
					ManufacturingStale:          true,
					CurrentDesignRevisionID:     "3f0c9c11-0000-4000-8000-000000000006",
					CurrentDesignRevisionNumber: 4,
				},
			},
		},
		getProductionReleaseResult: &storage.ProductionReleaseReadback{
			Release: domain.ProductionRelease{
				ID:                       releaseTestReleaseID,
				ProjectID:                releaseTestProjectID,
				DesignRevisionID:         releaseTestRevisionID,
				ReleaseNumber:            2,
				DesignRevisionNumber:     3,
				ManufacturingFingerprint: "sha256-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
				Status:                   domain.ProductionReleaseStatusActive,
				ReleasedBy:               "user-release",
			},
		},
	}
	server := &Server{Store: store}

	listReq := httptest.NewRequest(http.MethodGet, "/api/projects/"+releaseTestProjectID+"/production-releases", nil)
	listReq.SetPathValue("projectId", releaseTestProjectID)
	listReq = withTestClaims(listReq, "user-1", []domain.UserRole{domain.RoleProduccion})
	listW := httptest.NewRecorder()
	server.HandleProjectProductionReleases(listW, listReq)
	if listW.Code != http.StatusOK {
		t.Fatalf("list: expected 200, got %d: %s", listW.Code, listW.Body.String())
	}
	var releases []map[string]any
	if err := json.NewDecoder(listW.Body).Decode(&releases); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(releases) != 1 {
		t.Fatalf("expected 1 release, got %d", len(releases))
	}
	staleness := releases[0]["staleness"].(map[string]any)
	if staleness["manufacturing_stale"] != true {
		t.Fatalf("staleness projection must surface manufacturing_stale: %v", staleness)
	}
	if _, ok := releases[0]["quote_revision_id"]; ok {
		t.Fatalf("releases without commercial baseline must omit quote_revision_id or expose null")
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/projects/"+releaseTestProjectID+"/production-releases/"+releaseTestReleaseID, nil)
	getReq.SetPathValue("projectId", releaseTestProjectID)
	getReq.SetPathValue("releaseId", releaseTestReleaseID)
	getReq = withTestClaims(getReq, "user-1", []domain.UserRole{domain.RoleAdmin})
	getW := httptest.NewRecorder()
	server.HandleProjectProductionRelease(getW, getReq)
	if getW.Code != http.StatusOK {
		t.Fatalf("get: expected 200, got %d: %s", getW.Code, getW.Body.String())
	}

	getMissing := httptest.NewRequest(http.MethodGet, "/api/projects/"+releaseTestProjectID+"/production-releases/"+releaseTestReleaseID, nil)
	getMissing.SetPathValue("projectId", releaseTestProjectID)
	getMissing.SetPathValue("releaseId", releaseTestReleaseID)
	getMissing = withTestClaims(getMissing, "user-1", []domain.UserRole{domain.RoleAdmin})
	missingStore := &Server{Store: &stubStore{getProductionReleaseErr: domain.ErrReleaseNotFound}}
	getMissingW := httptest.NewRecorder()
	missingStore.HandleProjectProductionRelease(getMissingW, getMissing)
	if getMissingW.Code != http.StatusNotFound {
		t.Fatalf("missing release must 404, got %d", getMissingW.Code)
	}
}

// releaseIdempotentStore mirrors requoteIdempotentStore: the receipt replays
// the byte-identical release and the command executes exactly once (#395 §28).
type releaseIdempotentStore struct {
	*stubStore
	receipts map[string]storage.IdempotencyResponse
}

func (s *releaseIdempotentStore) ExecuteIdempotent(ctx context.Context, req storage.IdempotencyRequest, execute func(context.Context) (storage.IdempotencyResponse, error)) (storage.IdempotencyResponse, bool, error) {
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

func TestHandleProjectProductionReleases_IdempotentRetryReplaysSameRelease(t *testing.T) {
	store := &releaseIdempotentStore{stubStore: &stubStore{}, receipts: map[string]storage.IdempotencyResponse{}}
	server := &Server{Store: store}
	handler := server.RequireIdempotency("production.release", http.HandlerFunc(server.HandleProjectProductionReleases))

	body := `{"design_revision_id":"` + releaseTestRevisionID + `"}`
	do := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/projects/"+releaseTestProjectID+"/production-releases", bytes.NewBufferString(body))
		req.SetPathValue("projectId", releaseTestProjectID)
		req = withTestClaims(req, "user-release", []domain.UserRole{domain.RoleAdmin})
		req.Header.Set("Idempotency-Key", "release-retry-same-key-001")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w
	}

	first := do()
	if first.Code != http.StatusCreated {
		t.Fatalf("first call: expected 201, got %d: %s", first.Code, first.Body.String())
	}
	second := do()
	if second.Code != http.StatusCreated {
		t.Fatalf("retry: expected 201 replay, got %d: %s", second.Code, second.Body.String())
	}
	if second.Body.String() != first.Body.String() {
		t.Fatalf("retry must replay the byte-identical release (P1), never mint P2")
	}
	if store.createProductionReleaseCalls != 1 {
		t.Fatalf("the durable release command must execute exactly once, got %d calls", store.createProductionReleaseCalls)
	}
}

// The full router must register the #395 patterns without ServeMux conflicts
// (the revision command router coexists with the exact revision GET and the
// legacy publish POST).
func TestProductionRelease_RouterRegistration(t *testing.T) {
	server := &Server{Store: &stubStore{}, Tokens: mustAuthority("release-router-test-jwt-secret-0123456789"), allowedOrigins: []string{"http://localhost"}}
	router := RegisterRoutes(server)
	if router == nil {
		t.Fatal("RegisterRoutes must succeed")
	}
}
