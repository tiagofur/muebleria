package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #499 / DT-SU-1: pairing grant handler tests (withClaims + stubStore, no
// DB): grant creation returns the code exactly once, the exchange is an
// extension-credential-only command reusing the #388 binding context, and
// the negative proofs (foreign grant, replay, bad code, web-session
// exchange, org-less device) each answer their typed status.

const (
	pairingTestSessionID = "7e700000-0000-0000-0000-000000000001"
	pairingTestGrantID   = "88000000-0000-0000-0000-000000000001"
)

func pairingTestGrant() *domain.DesignPairingGrant {
	expires := time.Now().Add(pairingGrantTTL)
	return &domain.DesignPairingGrant{
		ID:             pairingTestGrantID,
		OrganizationID: storage.InitialOrganizationID,
		ProjectID:      designTestProjectID,
		DesignID:       designTestDesignID,
		Action:         domain.PairingActionOpenDesign,
		Status:         domain.PairingGrantStatusPending,
		ExpiresAt:      expires,
		CreatedBy:      "admin-1",
		CreatedAt:      time.Now().Add(-time.Minute),
		UpdatedAt:      time.Now().Add(-time.Minute),
	}
}

func pairingTestBindingContext() *storage.ModelBindingContext {
	design := domain.Design{
		ID:             designTestDesignID,
		ProjectID:      designTestProjectID,
		Name:           "Diseño Principal",
		Status:         domain.DesignStatusActive,
		OrganizationID: storage.InitialOrganizationID,
	}
	return &storage.ModelBindingContext{
		ProjectID:        designTestProjectID,
		ProjectName:      "Obra Demo",
		OrganizationID:   storage.InitialOrganizationID,
		OrganizationName: "Taller Demo",
		Design:           design,
	}
}

func withExtensionClaims(req *http.Request, userID string) *http.Request {
	return withExtensionClaimsOrg(req, userID, storage.InitialOrganizationID)
}

func withExtensionClaimsOrg(req *http.Request, userID, orgID string) *http.Request {
	claims := &auth.Claims{
		UserID: userID,
		Role:   string(domain.RoleAdmin),
		OrgID:  orgID,
		Client: auth.ExtensionClient,
		Sid:    pairingTestSessionID,
	}
	ctx := context.WithValue(req.Context(), UserContextKey, claims)
	ctx = storage.WithOrgCtx(ctx, storage.InitialOrganizationID)
	return req.WithContext(ctx)
}

// --- stubStore methods (pairing grants, #499) ---

func (s *stubStore) CreateDesignPairingGrant(_ context.Context, cmd storage.CreateDesignPairingGrantCommand) (*domain.DesignPairingGrant, error) {
	s.createPairingGrantCmd = &cmd
	if s.createPairingGrantErr != nil {
		return nil, s.createPairingGrantErr
	}
	grant := pairingTestGrant()
	grant.ProjectID = cmd.ProjectID
	grant.DesignID = cmd.DesignID
	grant.Action = cmd.Action
	if cmd.BaseRevisionID != "" {
		base := cmd.BaseRevisionID
		grant.BaseRevisionID = &base
	}
	return grant, nil
}

func (s *stubStore) ExchangeDesignPairingGrant(_ context.Context, cmd storage.ExchangeDesignPairingGrantCommand) (*domain.DesignPairingGrant, error) {
	s.exchangePairingGrantCmd = &cmd
	if s.exchangePairingGrantErr != nil {
		return nil, s.exchangePairingGrantErr
	}
	grant := pairingTestGrant()
	grant.Status = domain.PairingGrantStatusExchanged
	now := time.Now()
	grant.ExchangedAt = &now
	session := pairingTestSessionID
	grant.ExchangedBySessionID = &session
	return grant, nil
}

func (s *stubStore) GetDesignPairingGrant(_ context.Context, projectID, designID, grantID string) (*domain.DesignPairingGrant, error) {
	if s.pairingGrantErr != nil {
		return nil, s.pairingGrantErr
	}
	if s.pairingGrant == nil {
		return nil, storage.ErrPairingGrantNotFound
	}
	grant := s.pairingGrant
	if grant.ProjectID != projectID || grant.DesignID != designID || grant.ID != grantID {
		return nil, storage.ErrPairingGrantNotFound
	}
	return grant, nil
}

func (s *stubStore) CancelDesignPairingGrant(_ context.Context, cmd storage.CancelDesignPairingGrantCommand) (*domain.DesignPairingGrant, error) {
	s.cancelPairingGrantCmd = &cmd
	if s.cancelPairingGrantErr != nil {
		return nil, s.cancelPairingGrantErr
	}
	grant := pairingTestGrant()
	grant.ID = cmd.GrantID
	grant.Status = domain.PairingGrantStatusCancelled
	return grant, nil
}

// --- handler tests ---

func TestHandlePairingGrant_CreateReturns201WithOneTimeCode(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}

	req := withClaims(httptest.NewRequest(http.MethodPost,
		"/api/projects/"+designTestProjectID+"/designs/"+designTestDesignID+"/pairing-grants",
		strings.NewReader(`{"action":"open_design"}`)), "admin-1", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("projectId", designTestProjectID)
	req.SetPathValue("designId", designTestDesignID)
	rr := httptest.NewRecorder()

	srv.HandleDesignPairingGrantCreate(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	var body struct {
		ID     string `json:"id"`
		Status string `json:"status"`
		Code   string `json:"code"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.ID != pairingTestGrantID || body.Status != domain.PairingGrantStatusPending {
		t.Fatalf("unexpected grant header: %+v", body)
	}
	if len(body.Code) != pairingCodeLength {
		t.Fatalf("code = %q, want %d opaque chars", body.Code, pairingCodeLength)
	}
	cmd := *store.createPairingGrantCmd
	if cmd.ProjectID != designTestProjectID || cmd.DesignID != designTestDesignID {
		t.Fatalf("command scope mismatch: %+v", cmd)
	}
	if cmd.Action != domain.PairingActionOpenDesign {
		t.Fatalf("action = %q, want open_design", cmd.Action)
	}
	if cmd.TTL != pairingGrantTTL {
		t.Fatalf("TTL = %v, want %v", cmd.TTL, pairingGrantTTL)
	}
}

func TestHandlePairingGrant_CreateRejectsUnknownAction(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodPost,
		"/api/projects/"+designTestProjectID+"/designs/"+designTestDesignID+"/pairing-grants",
		strings.NewReader(`{"action":"delete_everything"}`)), "admin-1", string(domain.RoleAdmin))
	req.SetPathValue("projectId", designTestProjectID)
	req.SetPathValue("designId", designTestDesignID)
	rr := httptest.NewRecorder()

	srv.HandleDesignPairingGrantCreate(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
	if store.createPairingGrantCmd != nil {
		t.Fatal("store must not receive a command for an unknown action")
	}
}

func TestHandlePairingGrant_CreateDeniesRoleWithoutProjectAccess(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodPost,
		"/api/projects/"+designTestProjectID+"/designs/"+designTestDesignID+"/pairing-grants",
		strings.NewReader(`{"action":"open_design"}`)), "user-1", string(domain.RoleUser))
	req.SetPathValue("projectId", designTestProjectID)
	req.SetPathValue("designId", designTestDesignID)
	rr := httptest.NewRecorder()

	srv.HandleDesignPairingGrantCreate(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rr.Code)
	}
	if store.createPairingGrantCmd != nil {
		t.Fatal("store must not receive a command for a forbidden role")
	}
}

func TestHandlePairingGrant_CreateUniform404ForForeignPair(t *testing.T) {
	store := &stubStore{createPairingGrantErr: domain.ErrDesignNotFound}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodPost,
		"/api/projects/"+designTestProjectID+"/designs/"+designTestDesignID+"/pairing-grants",
		strings.NewReader(`{"action":"open_design"}`)), "admin-1", string(domain.RoleAdmin))
	req.SetPathValue("projectId", designTestProjectID)
	req.SetPathValue("designId", designTestDesignID)
	rr := httptest.NewRecorder()

	srv.HandleDesignPairingGrantCreate(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
	if strings.Contains(rr.Body.String(), designTestProjectID) {
		t.Fatal("404 body must not echo the probed identity")
	}
}

func exchangeRequest(t *testing.T, srv *Server, store *stubStore, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := withExtensionClaims(httptest.NewRequest(http.MethodPost,
		"/api/design-pairing-grants:exchange", strings.NewReader(body)),
		"device-owner-1")
	rr := httptest.NewRecorder()
	srv.HandleDesignPairingGrantExchange(rr, req)
	return rr
}

func TestHandlePairingGrant_ExchangeConsumesAndReturnsBindingContext(t *testing.T) {
	store := &stubStore{modelBindingContext: pairingTestBindingContext()}
	srv := &Server{Store: store}

	rr := exchangeRequest(t, srv, store, `{"code":"ABCDEFGHJKLM"}`)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var body struct {
		GrantID string `json:"grant_id"`
		State   string `json:"state"`
		Project struct {
			Name string `json:"name"`
		} `json:"project"`
		Capabilities struct {
			CanEdit    bool `json:"can_edit_working_copy"`
			CanPublish bool `json:"can_publish_revision"`
		} `json:"capabilities"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.GrantID != pairingTestGrantID || body.State != "valid" {
		t.Fatalf("unexpected exchange payload: %+v", body)
	}
	if body.Project.Name != "Obra Demo" {
		t.Fatalf("project name = %q, want the authoritative #388 context", body.Project.Name)
	}
	if !body.Capabilities.CanEdit || !body.Capabilities.CanPublish {
		t.Fatalf("admin device capabilities = %+v, want edit+publish", body.Capabilities)
	}
	cmd := *store.exchangePairingGrantCmd
	if cmd.Code != "ABCDEFGHJKLM" {
		t.Fatalf("exchange code = %q, want the normalized code", cmd.Code)
	}
	if cmd.ExchangedBySessionID != pairingTestSessionID {
		t.Fatalf("session id = %q, want the extension token sid", cmd.ExchangedBySessionID)
	}
}

func TestHandlePairingGrant_ExchangeRejectsWebSession(t *testing.T) {
	store := &stubStore{modelBindingContext: pairingTestBindingContext()}
	srv := &Server{Store: store}

	req := withClaims(httptest.NewRequest(http.MethodPost,
		"/api/design-pairing-grants:exchange", strings.NewReader(`{"code":"ABCDEFGHJKLM"}`)),
		"admin-1", string(domain.RoleAdmin))
	rr := httptest.NewRecorder()
	srv.HandleDesignPairingGrantExchange(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for a web-session exchange", rr.Code)
	}
	if store.exchangePairingGrantCmd != nil {
		t.Fatal("a web session must never consume a pairing grant")
	}
}

func TestHandlePairingGrant_ExchangeRejectsOrgLessDevice(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	req := withExtensionClaimsOrg(httptest.NewRequest(http.MethodPost,
		"/api/design-pairing-grants:exchange", strings.NewReader(`{"code":"ABCDEFGHJKLM"}`)),
		"device-owner-1", "")
	rr := httptest.NewRecorder()
	srv.HandleDesignPairingGrantExchange(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for an org-less device", rr.Code)
	}
}

func TestHandlePairingGrant_ExchangeRejectsMalformedCode(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	rr := exchangeRequest(t, srv, store, `{"code":"corto"}`)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
	if store.exchangePairingGrantCmd != nil {
		t.Fatal("store must not receive a malformed code")
	}
}

func TestHandlePairingGrant_ExchangeUniform404ForUnknownOrForeignCode(t *testing.T) {
	store := &stubStore{exchangePairingGrantErr: storage.ErrPairingGrantNotFound}
	srv := &Server{Store: store}
	rr := exchangeRequest(t, srv, store, `{"code":"ZZZZZZZZZZZZ"}`)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
}

func TestHandlePairingGrant_Exchange409ForReplayedOrExpiredGrant(t *testing.T) {
	store := &stubStore{exchangePairingGrantErr: storage.ErrPairingGrantConflict}
	srv := &Server{Store: store}
	rr := exchangeRequest(t, srv, store, `{"code":"ABCDEFGHJKLM"}`)
	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rr.Code)
	}
}

func TestHandlePairingGrant_Exchange404WhenDesignVanishedAfterCreate(t *testing.T) {
	store := &stubStore{
		modelBindingContextErr: domain.ErrDesignNotFound,
	}
	srv := &Server{Store: store}
	rr := exchangeRequest(t, srv, store, `{"code":"ABCDEFGHJKLM"}`)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 when the design no longer exists", rr.Code)
	}
}

func TestHandlePairingGrant_StatusDerivesExpired(t *testing.T) {
	grant := pairingTestGrant()
	grant.ExpiresAt = time.Now().Add(-time.Minute)
	store := &stubStore{pairingGrant: grant}
	srv := &Server{Store: store}

	req := withClaims(httptest.NewRequest(http.MethodGet,
		"/api/projects/"+designTestProjectID+"/designs/"+designTestDesignID+"/pairing-grants/"+pairingTestGrantID, nil),
		"admin-1", string(domain.RoleAdmin))
	req.SetPathValue("projectId", designTestProjectID)
	req.SetPathValue("designId", designTestDesignID)
	req.SetPathValue("grantId", pairingTestGrantID)
	rr := httptest.NewRecorder()

	srv.HandleDesignPairingGrantStatus(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var body struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Status != domain.PairingGrantStatusExpired {
		t.Fatalf("derived status = %q, want expired", body.Status)
	}
}

func TestHandlePairingGrant_CancelMarksCancelledAndRejectsDoubleCancel(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}

	req := withClaims(httptest.NewRequest(http.MethodPost,
		"/api/projects/"+designTestProjectID+"/designs/"+designTestDesignID+"/pairing-grants/"+pairingTestGrantID+":cancel", nil),
		"admin-1", string(domain.RoleAdmin))
	req.SetPathValue("projectId", designTestProjectID)
	req.SetPathValue("designId", designTestDesignID)
	req.SetPathValue("grantId", pairingTestGrantID)
	rr := httptest.NewRecorder()
	srv.HandleDesignPairingGrantCancel(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var body struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Status != domain.PairingGrantStatusCancelled {
		t.Fatalf("status = %q, want cancelled", body.Status)
	}

	store.cancelPairingGrantErr = storage.ErrPairingGrantConflict
	rr = httptest.NewRecorder()
	srv.HandleDesignPairingGrantCancel(rr, req)
	if rr.Code != http.StatusConflict {
		t.Fatalf("second cancel = %d, want 409", rr.Code)
	}
}
