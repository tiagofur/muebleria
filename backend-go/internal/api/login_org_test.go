package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// F170 / #325: login with organization context — membership resolution,
// selection_required for multi-membership users and the select-org exchange.

func orgTestMembership(userID, orgID, slug string, roles []domain.UserRole) domain.MembershipWithOrg {
	return domain.MembershipWithOrg{
		Membership: domain.Membership{
			ID: userID + ":" + orgID, OrganizationID: orgID, UserID: userID, Roles: roles,
			Status: domain.MembershipStatusActive, CredentialVersion: 1,
		},
		Organization: domain.Organization{
			ID: orgID, Name: "Taller " + slug, Slug: slug, Type: domain.OrganizationTypeFactory,
			Status: domain.OrganizationStatusActive, CredentialVersion: 1},
	}
}

func loginTestServer(t *testing.T) (*Server, *stubStore) {
	t.Helper()
	hash, err := auth.HashPassword("secret123")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	u := &domain.User{
		ID: "u1", Email: "u@example.com", Name: "U", AccountStatus: domain.AccountStatusActive, PasswordHash: hash,
	}
	st := &stubStore{
		getUserByEmail: u,
		membershipsByUser: map[string][]domain.MembershipWithOrg{
			"u1": {
				orgTestMembership("u1", "org-1", "taller-uno", []domain.UserRole{domain.RoleVendedor}),
				orgTestMembership("u1", "org-2", "taller-dos", []domain.UserRole{domain.RoleAdmin}),
			},
		},
	}
	return &Server{Store: st, JWTSecret: "unit-test-secret-0123456789abcdef"}, st
}

type selectOrgTenantActorStore struct {
	*stubStore
	actor storage.TenantActor
}

func (s *selectOrgTenantActorStore) SetTenantActor(ctx context.Context, actor storage.TenantActor) (context.Context, error) {
	s.actor = actor
	return ctx, nil
}

func doLogin(t *testing.T, s *Server, payload map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	if _, ok := payload["transport"]; !ok {
		payload["transport"] = "web"
	}
	body, _ := json.Marshal(payload)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	s.HandleLogin(rec, req)
	return rec
}

func TestLogin_MultiMembershipRequiresSelection(t *testing.T) {
	server, _ := loginTestServer(t)
	rec := doLogin(t, server, map[string]string{"email": "u@example.com", "password": "secret123"})

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Token             string          `json:"token"`
		SelectionRequired bool            `json:"selection_required"`
		Memberships       []MembershipDTO `json:"memberships"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if !resp.SelectionRequired {
		t.Fatal("multi-membership login must require selection")
	}
	// The org-less token is issued ONLY to complete select-org; it must not
	// carry any organization scope.
	if resp.Token == "" {
		t.Fatal("org-less token must be issued for the selection step")
	}
	claims, err := auth.ValidateToken(resp.Token, server.JWTSecret)
	if err != nil {
		t.Fatal(err)
	}
	if claims.OrgID != "" {
		t.Fatalf("selection token must be org-less, got org %s", claims.OrgID)
	}
	if len(resp.Memberships) != 2 {
		t.Fatalf("memberships = %d, want 2", len(resp.Memberships))
	}
}

func TestLogin_OrgHintPreSelectsMembership(t *testing.T) {
	server, _ := loginTestServer(t)
	rec := doLogin(t, server, map[string]string{
		"email": "u@example.com", "password": "secret123", "org": "taller-dos",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var resp LoginResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Token == "" || resp.Organization == nil || resp.Organization.Slug != "taller-dos" {
		t.Fatalf("expected org-scoped token for taller-dos, got %+v", resp.Organization)
	}
	claims, err := auth.ValidateToken(resp.Token, server.JWTSecret)
	if err != nil {
		t.Fatal(err)
	}
	if claims.OrgID != "org-2" || claims.Role != string(domain.RoleAdmin) {
		t.Fatalf("claims org/role = %s/%s, want org-2/admin", claims.OrgID, claims.Role)
	}
}

func TestLogin_NoMembershipNoPlatform(t *testing.T) {
	server, st := loginTestServer(t)
	st.membershipsByUser = nil
	rec := doLogin(t, server, map[string]string{"email": "u@example.com", "password": "secret123"})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestMe_EmitsAuthoritativeSessionScope(t *testing.T) {
	server, st := loginTestServer(t)
	suspended := orgTestMembership("u1", "org-suspended", "suspended", []domain.UserRole{domain.RoleAdmin})
	suspended.Status = domain.MembershipStatusSuspended
	st.membershipsByUser["u1"] = append(st.membershipsByUser["u1"], suspended)
	token, err := auth.GenerateToken("u1", "u@example.com", auth.TokenContext{
		Roles: []string{"admin"}, OrgID: "org-2", MembershipID: "u1:org-2",
		MembershipCredentialVersion: 4, OrganizationCredentialVersion: 7,
	}, server.JWTSecret)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := auth.ValidateToken(token, server.JWTSecret)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	req = req.WithContext(context.WithValue(req.Context(), UserContextKey, claims))
	rec := httptest.NewRecorder()

	server.HandleMe(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var response openapi.MeResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	scope := response.SessionScope
	if scope.UserID != "u1" || scope.MembershipID == nil || *scope.MembershipID != "u1:org-2" ||
		scope.OrganizationID == nil || *scope.OrganizationID != "org-2" || scope.Mode != "auth" ||
		scope.MembershipCredentialVersion == nil || *scope.MembershipCredentialVersion != 4 ||
		scope.OrganizationCredentialVersion == nil || *scope.OrganizationCredentialVersion != 7 ||
		scope.AbsoluteExpiresAt == "" {
		t.Fatalf("unexpected session scope: %+v", scope)
	}
	if len(response.Memberships) != 2 {
		t.Fatalf("selectable memberships = %d, want only 2 active choices", len(response.Memberships))
	}
	for _, membership := range response.Memberships {
		if membership.Status != openapi.MembershipStatusActive || membership.Organization.Status != openapi.OrganizationStatusActive {
			t.Fatalf("non-selectable membership exposed: %+v", membership)
		}
	}
}

func TestMe_SeparatesSupportScopeFromMembershipScope(t *testing.T) {
	server, st := loginTestServer(t)
	st.getUserByEmail.PlatformAdmin = true
	st.membershipsByUser = nil
	st.getOrgByID = &domain.Organization{
		ID: "org-2", Name: "Support target", Slug: "support-target", Type: domain.OrganizationTypeFactory,
		Status: domain.OrganizationStatusActive, CredentialVersion: 9,
	}
	token, err := auth.GenerateSupportToken("u1", "u@example.com", auth.SupportClaims{
		OrgID: "org-2", SessionID: "support-1", OrganizationCredentialVersion: 9, Reason: "investigation",
	}, server.JWTSecret)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := auth.ValidateToken(token, server.JWTSecret)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	req = req.WithContext(context.WithValue(req.Context(), UserContextKey, claims))
	rec := httptest.NewRecorder()
	server.HandleMe(rec, req)

	var response openapi.MeResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	scope := response.SessionScope
	if rec.Code != http.StatusOK || scope.Mode != "support" || scope.SupportSessionID == nil ||
		*scope.SupportSessionID != "support-1" || scope.MembershipID != nil ||
		scope.MembershipCredentialVersion != nil || scope.OrganizationCredentialVersion == nil ||
		*scope.OrganizationCredentialVersion != 9 {
		t.Fatalf("unexpected support scope: status=%d scope=%+v", rec.Code, scope)
	}
	if response.Organization == nil || response.Organization.ID != "org-2" || len(response.Memberships) != 0 {
		t.Fatalf("support target snapshot must not require actor membership: organization=%+v memberships=%+v", response.Organization, response.Memberships)
	}
}

func TestSelectOrg_IssuesScopedToken(t *testing.T) {
	server, _ := loginTestServer(t)

	// Org-less token (as issued to platform staff / multi-membership users).
	token, err := auth.GenerateToken("u1", "u@example.com", auth.TokenContext{}, server.JWTSecret)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]string{"organization_id": "org-1"})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/select-org", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	AuthMiddleware(server.JWTSecret, server.Store)(http.HandlerFunc(server.HandleSelectOrg)).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var resp LoginResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	claims, err := auth.ValidateToken(resp.Token, server.JWTSecret)
	if err != nil {
		t.Fatal(err)
	}
	if claims.OrgID != "org-1" || claims.Role != string(domain.RoleVendedor) {
		t.Fatalf("claims = org %s role %s, want org-1/vendedor", claims.OrgID, claims.Role)
	}
}

func TestSelectOrg_ScopesValidatedSelectionBeforeAudit(t *testing.T) {
	server, stub := loginTestServer(t)
	store := &selectOrgTenantActorStore{stubStore: stub}
	server.Store = store
	token, err := auth.GenerateToken("u1", "u@example.com", auth.TokenContext{}, server.JWTSecret)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]string{"organization_id": "org-1"})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/select-org", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	AuthMiddleware(server.JWTSecret, server.Store)(http.HandlerFunc(server.HandleSelectOrg)).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK || store.actor.OrganizationID != "org-1" || store.actor.UserID != "u1" {
		t.Fatalf("status=%d actor=%+v", rec.Code, store.actor)
	}
}

func TestSelectOrg_RejectsForeignOrganization(t *testing.T) {
	server, _ := loginTestServer(t)
	token, _ := auth.GenerateToken("u1", "u@example.com", auth.TokenContext{}, server.JWTSecret)

	body, _ := json.Marshal(map[string]string{"organization_id": "org-x"})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/select-org", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	AuthMiddleware(server.JWTSecret, server.Store)(http.HandlerFunc(server.HandleSelectOrg)).ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("foreign org: expected 403, got %d", rec.Code)
	}
	var apiError openapi.ApiError
	if err := json.Unmarshal(rec.Body.Bytes(), &apiError); err != nil {
		t.Fatal(err)
	}
	if apiError.Code != openapi.ApiErrorCodeMembershipNotSelectable {
		t.Fatalf("foreign org code = %s, want MEMBERSHIP_NOT_SELECTABLE", apiError.Code)
	}
}

func TestSelectOrg_InternalMembershipFailureIsNotRevoked(t *testing.T) {
	for _, test := range []struct {
		name      string
		configure func(*stubStore)
	}{
		{name: "store error", configure: func(store *stubStore) { store.getActiveMembershipErr = errors.New("membership scan failed") }},
		{name: "empty store result", configure: func(store *stubStore) { store.getActiveMembershipEmpty = true }},
	} {
		t.Run(test.name, func(t *testing.T) {
			server, store := loginTestServer(t)
			test.configure(store)
			token, _ := auth.GenerateToken("u1", "u@example.com", auth.TokenContext{}, server.JWTSecret)
			body, _ := json.Marshal(map[string]string{"organization_id": "org-1"})
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/auth/select-org", bytes.NewReader(body))
			req.Header.Set("Authorization", "Bearer "+token)
			AuthMiddleware(server.JWTSecret, server.Store)(http.HandlerFunc(server.HandleSelectOrg)).ServeHTTP(rec, req)

			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("internal membership failure: expected 500, got %d", rec.Code)
			}
			var apiError openapi.ApiError
			if err := json.Unmarshal(rec.Body.Bytes(), &apiError); err != nil {
				t.Fatal(err)
			}
			if apiError.Code != openapi.ApiErrorCodeInternalError || bytes.Contains(rec.Body.Bytes(), []byte(`"token"`)) || bytes.Contains(rec.Body.Bytes(), []byte(`"selection_required"`)) {
				t.Fatalf("internal membership failure returned code %s or selection token", apiError.Code)
			}
		})
	}
}

func TestLogin_FailureIsAudited(t *testing.T) {
	server, st := loginTestServer(t)
	rec := doLogin(t, server, map[string]string{"email": "u@example.com", "password": "wrong"})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", rec.Code)
	}
	// The audit write is best-effort in the handler; the stub records nothing,
	// so this locks the response contract only (uniform 401, no enumeration).
	if rec.Body.String() == "" {
		t.Fatal("expected error body")
	}
	_ = st
}

func TestSelectOrg_PreservesAbsoluteAuthStart(t *testing.T) {
	server, _ := loginTestServer(t)
	started := time.Now().UTC().Add(-time.Hour).Truncate(time.Second)
	token, err := auth.GenerateToken("u1", "u@example.com", auth.TokenContext{AuthStartedAt: started}, server.JWTSecret)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]string{"organization_id": "org-1"})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/select-org", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	AuthMiddleware(server.JWTSecret, server.Store)(http.HandlerFunc(server.HandleSelectOrg)).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var resp LoginResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	claims, err := auth.ValidateToken(resp.Token, server.JWTSecret)
	if err != nil {
		t.Fatal(err)
	}
	if !claims.AuthStartedAt.Time.Equal(started) {
		t.Fatalf("auth_started_at = %s, want %s", claims.AuthStartedAt.Time, started)
	}
	if want := started.Add(auth.AccessTokenTTL); !claims.ExpiresAt.Time.Equal(want) {
		t.Fatalf("expiry = %s, want %s", claims.ExpiresAt.Time, want)
	}
}

func TestRefresh_PreservesAbsoluteAuthStart(t *testing.T) {
	server, _ := loginTestServer(t)
	started := time.Now().UTC().Add(-time.Hour).Truncate(time.Second)
	token, err := auth.GenerateToken("u1", "u@example.com", auth.TokenContext{
		Roles:                         []string{string(domain.RoleVendedor)},
		OrgID:                         "org-1",
		MembershipID:                  "u1:org-1",
		MembershipCredentialVersion:   1,
		OrganizationCredentialVersion: 1,
		AuthStartedAt:                 started,
	}, server.JWTSecret)
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	AuthMiddleware(server.JWTSecret, server.Store)(http.HandlerFunc(server.HandleRefresh)).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var resp LoginResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	claims, err := auth.ValidateToken(resp.Token, server.JWTSecret)
	if err != nil {
		t.Fatal(err)
	}
	if !claims.AuthStartedAt.Time.Equal(started) {
		t.Fatalf("auth_started_at = %s, want %s", claims.AuthStartedAt.Time, started)
	}
	if want := started.Add(auth.AccessTokenTTL); !claims.ExpiresAt.Time.Equal(want) {
		t.Fatalf("expiry = %s, want %s", claims.ExpiresAt.Time, want)
	}
}
