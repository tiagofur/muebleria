package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func okHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}
}

// errorBody parses the JSON error envelope used by respondWithError.
func errorBody(t *testing.T, rr *httptest.ResponseRecorder) string {
	t.Helper()
	var m struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &m); err != nil {
		t.Fatalf("response is not a JSON error envelope: %v (body=%q)", err, rr.Body.String())
	}
	return m.Message
}

// staticUsers implements UserLookup for middleware tests.
type staticUsers struct {
	byID        map[string]*domain.User
	err         error
	memberships map[string]*domain.MembershipWithOrg
}

type commitFailingUsers struct {
	*staticUsers
	commitErr error
}

func (s *commitFailingUsers) WithinTenantTx(ctx context.Context, _ storage.TenantActor, execute func(context.Context) error) error {
	if err := execute(ctx); err != nil {
		return err
	}
	return s.commitErr
}

func (s *staticUsers) GetUserByID(_ context.Context, id string) (*domain.User, error) {
	if s.err != nil {
		return nil, s.err
	}
	u, ok := s.byID[id]
	if !ok {
		return nil, errors.New("user not found")
	}
	return u, nil
}

func (s *staticUsers) GetOpenSupportSession(context.Context, string) (*domain.SupportSession, error) {
	return nil, errors.New("support session not found")
}

// membershipsByUser keyed by "userID:orgID" lets middleware tests simulate
// live membership state (revocation, role changes, suspended organizations).
func (s *staticUsers) GetActiveMembership(_ context.Context, userID, organizationID string) (*domain.MembershipWithOrg, error) {
	if s.memberships == nil {
		return nil, errors.New("membership not found")
	}
	m, ok := s.memberships[userID+":"+organizationID]
	if !ok {
		return nil, errors.New("membership not found")
	}
	return m, nil
}

func TestCORSMiddleware(t *testing.T) {
	allowed := []string{"http://localhost:5173", "https://app.example.com"}
	corsHandler := CORSMiddleware(allowed)(okHandler())

	// Allowed origin → reflected, plus Vary.
	req := httptest.NewRequest("GET", "/api/any", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	rr := httptest.NewRecorder()
	corsHandler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("allowed origin: expected 200, got %d", rr.Code)
	}
	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Errorf("allowed origin: expected reflected origin, got %q", got)
	}
	if got := rr.Header().Get("Vary"); got != "Origin" {
		t.Errorf("expected Vary: Origin, got %q", got)
	}

	// Disallowed origin → no Allow-Origin header.
	req = httptest.NewRequest("GET", "/api/any", nil)
	req.Header.Set("Origin", "http://evil.test")
	rr = httptest.NewRecorder()
	corsHandler.ServeHTTP(rr, req)
	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("disallowed origin: expected no Allow-Origin header, got %q", got)
	}

	// OPTIONS preflight from allowed origin → 204.
	req = httptest.NewRequest("OPTIONS", "/api/any", nil)
	req.Header.Set("Origin", "https://app.example.com")
	rr = httptest.NewRecorder()
	corsHandler.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Errorf("preflight: expected 204, got %d", rr.Code)
	}
	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "https://app.example.com" {
		t.Errorf("preflight: expected reflected origin, got %q", got)
	}
}

func TestAuthMiddleware(t *testing.T) {
	secret := "super-secret-test-key-0123456789"
	users := &staticUsers{
		byID: map[string]*domain.User{
			"user-1": {
				ID: "user-1", Email: "user@test.com",
				AccountStatus: domain.AccountStatusActive,
			},
		},
		memberships: map[string]*domain.MembershipWithOrg{
			"user-1:org-1": {
				Membership: domain.Membership{
					ID: "user-1:org-1", OrganizationID: "org-1", UserID: "user-1",
					CredentialVersion: 1, Roles: []domain.UserRole{domain.RoleAdmin}, Status: domain.MembershipStatusActive,
				},
				Organization: domain.Organization{ID: "org-1", Status: domain.OrganizationStatusActive, CredentialVersion: 1},
			},
		},
	}
	middleware := AuthMiddleware(mustAuthority(secret), users)

	handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := r.Context().Value(UserContextKey).(*auth.Claims)
		if !ok || claims == nil {
			respondWithError(w, http.StatusInternalServerError, "no claims found")
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(claims.Email))
	}))

	// Case 1: No Authorization header → 401 JSON.
	req := httptest.NewRequest("GET", "/api/protected", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("no header: expected 401, got %d", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("no header: expected JSON content-type, got %q", ct)
	}

	// Case 2: Invalid format → 401 JSON.
	req = httptest.NewRequest("GET", "/api/protected", nil)
	req.Header.Set("Authorization", "InvalidFormat token-here")
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("bad format: expected 401, got %d", rr.Code)
	}

	// Case 3: Tampered token → 401 with generic message, NOT the parser error.
	req = httptest.NewRequest("GET", "/api/protected", nil)
	req.Header.Set("Authorization", "Bearer not.a.real.token")
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("bad token: expected 401, got %d", rr.Code)
	}
	msg := errorBody(t, rr)
	if msg != "invalid token" {
		t.Errorf("bad token: expected generic 'invalid token', got leaked %q", msg)
	}

	// Case 4: Valid org-scoped Token + active user in DB → 200.
	token, err := auth.GenerateLegacyWebToken("user-1", "user@test.com", auth.TokenContext{Roles: []string{"admin"}, OrgID: "org-1", MembershipID: "user-1:org-1", MembershipCredentialVersion: 1, OrganizationCredentialVersion: 1}, secret)
	if err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest("GET", "/api/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("valid token: expected 200, got %d", rr.Code)
	}
	if rr.Body.String() != "user@test.com" {
		t.Errorf("valid token: expected email in body, got %s", rr.Body.String())
	}
}

func TestAuthMiddleware_MapsDeferredTeamInvariantCommitError(t *testing.T) {
	secret := "super-secret-test-key-0123456789"
	users := &commitFailingUsers{
		staticUsers: &staticUsers{
			byID: map[string]*domain.User{
				"user-1": {ID: "user-1", Email: "user@test.com", AccountStatus: domain.AccountStatusActive},
			},
			memberships: map[string]*domain.MembershipWithOrg{
				"user-1:org-1": {
					Membership:   domain.Membership{ID: "user-1:org-1", OrganizationID: "org-1", UserID: "user-1", CredentialVersion: 1, Roles: []domain.UserRole{domain.RoleAdmin}, Status: domain.MembershipStatusActive},
					Organization: domain.Organization{ID: "org-1", Status: domain.OrganizationStatusActive, CredentialVersion: 1},
				},
			},
		},
		commitErr: &pgconn.PgError{Code: "23514", ConstraintName: organizationRequiresActiveAdminConstraint},
	}
	token, err := auth.GenerateLegacyWebToken("user-1", "user@test.com", auth.TokenContext{Roles: []string{"admin"}, OrgID: "org-1", MembershipID: "user-1:org-1", MembershipCredentialVersion: 1, OrganizationCredentialVersion: 1}, secret)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPut, "/api/org/memberships/member-2/roles", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	AuthMiddleware(mustAuthority(secret), users)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})).ServeHTTP(rr, req)
	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d: %s", rr.Code, http.StatusConflict, rr.Body.String())
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil || body.Code != "LAST_ADMIN" {
		t.Fatalf("deferred typed error code=%q err=%v body=%s", body.Code, err, rr.Body.String())
	}
}

// TestAuthMiddleware_OrgLessTokenFailClosed locks the #327 hardening: an
// org-less token (platform staff between support sessions, user mid
// org-selection) may only reach the platform console and auth endpoints.
// Business routes reject it instead of falling back to the initial
// organization's data. The legacy users.role bridge is gone: org-less tokens
// carry NO roles.
func TestAuthMiddleware_OrgLessTokenFailClosed(t *testing.T) {
	secret := "super-secret-test-key-0123456789"
	users := &staticUsers{byID: map[string]*domain.User{
		"p-1": {ID: "p-1", Email: "platform@test.com", AccountStatus: domain.AccountStatusActive, PlatformAdmin: true},
	}}

	var sawRoles []string
	handler := AuthMiddleware(mustAuthority(secret), users)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if claims, ok := r.Context().Value(UserContextKey).(*auth.Claims); ok && claims != nil {
			sawRoles = claims.Roles
		}
		w.WriteHeader(http.StatusOK)
	}))

	token, err := auth.GenerateLegacyWebToken("p-1", "platform@test.com", auth.TokenContext{Roles: []string{"admin"}}, secret)
	if err != nil {
		t.Fatal(err)
	}

	// Business route → 403, scope required.
	req := httptest.NewRequest("GET", "/api/projects", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("org-less business route: expected 403, got %d (body=%s)", rr.Code, rr.Body.String())
	}

	// Platform console route → passes through with NO roles (no bridge).
	req = httptest.NewRequest("GET", "/api/platform/organizations", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr = httptest.NewRecorder()
	sawRoles = []string{"sentinel"}
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("org-less platform route: expected 200, got %d (body=%s)", rr.Code, rr.Body.String())
	}
	if len(sawRoles) != 0 {
		t.Fatalf("org-less token must carry no roles, got %v", sawRoles)
	}

	// Canonical platform organization commands are outside the legacy
	// /api/platform prefix and must remain reachable by org-less staff.
	req = httptest.NewRequest("POST", "/api/organizations/org-1:suspend", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("org-less organization command: expected 200, got %d (body=%s)", rr.Code, rr.Body.String())
	}

	// Auth route (refresh/me) → passes through.
	req = httptest.NewRequest("POST", "/api/auth/refresh", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("org-less auth route: expected 200, got %d (body=%s)", rr.Code, rr.Body.String())
	}
}

// TestAuthMiddleware_RejectsDeactivatedUser locks issue #16: a still-valid JWT
// for a user who was deactivated must not grant access.
func TestAuthMiddleware_RejectsDeactivatedUser(t *testing.T) {
	secret := "super-secret-test-key-0123456789"
	users := &staticUsers{byID: map[string]*domain.User{
		"user-1": {
			ID: "user-1", Email: "user@test.com",
			AccountStatus: domain.AccountStatusDisabled,
		},
	}}
	handler := AuthMiddleware(mustAuthority(secret), users)(okHandler())

	token, err := auth.GenerateLegacyWebToken("user-1", "user@test.com", auth.TokenContext{Roles: []string{"admin"}}, secret)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("GET", "/api/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("deactivated user: expected 401, got %d", rr.Code)
	}
}

// TestAuthMiddleware_UsesLiveRoleFromDB locks issue #16: demoted admin must
// not pass AdminMiddleware even if JWT still says role=admin.
func TestAuthMiddleware_UsesLiveRoleFromDB(t *testing.T) {
	secret := "super-secret-test-key-0123456789"
	// Token was minted as admin, but the live membership says user.
	users := &staticUsers{
		byID: map[string]*domain.User{
			"a-1": {
				ID: "a-1", Email: "was-admin@test.com",
				AccountStatus: domain.AccountStatusActive,
			},
		},
		memberships: map[string]*domain.MembershipWithOrg{
			"a-1:org-1": {
				Membership: domain.Membership{
					ID: "a-1:org-1", OrganizationID: "org-1", UserID: "a-1",
					CredentialVersion: 1, Roles: []domain.UserRole{domain.RoleUser}, Status: domain.MembershipStatusActive,
				},
				Organization: domain.Organization{ID: "org-1", Status: domain.OrganizationStatusActive, CredentialVersion: 1},
			},
		},
	}
	handler := AdminMiddleware(mustAuthority(secret), users)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("admin-ok"))
	}))

	adminToken, err := auth.GenerateLegacyWebToken("a-1", "was-admin@test.com", auth.TokenContext{Roles: []string{"admin"}, OrgID: "org-1", MembershipID: "a-1:org-1", MembershipCredentialVersion: 1, OrganizationCredentialVersion: 1}, secret)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("GET", "/api/protected", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("demoted admin: expected 403, got %d (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestAdminMiddleware(t *testing.T) {
	secret := "super-secret-test-key-0123456789"
	users := &staticUsers{
		byID: map[string]*domain.User{
			"u-1": {ID: "u-1", Email: "user@test.com", AccountStatus: domain.AccountStatusActive},
			"a-1": {ID: "a-1", Email: "admin@test.com", AccountStatus: domain.AccountStatusActive, PlatformAdmin: true},
		},
		memberships: map[string]*domain.MembershipWithOrg{
			"u-1:org-1": {
				Membership: domain.Membership{
					ID: "u-1:org-1", OrganizationID: "org-1", UserID: "u-1",
					CredentialVersion: 1, Roles: []domain.UserRole{domain.RoleUser}, Status: domain.MembershipStatusActive,
				},
				Organization: domain.Organization{ID: "org-1", Status: domain.OrganizationStatusActive, CredentialVersion: 1},
			},
			"a-1:org-1": {
				Membership: domain.Membership{
					ID: "a-1:org-1", OrganizationID: "org-1", UserID: "a-1",
					CredentialVersion: 1, Roles: []domain.UserRole{domain.RoleAdmin}, Status: domain.MembershipStatusActive,
				},
				Organization: domain.Organization{ID: "org-1", Status: domain.OrganizationStatusActive, CredentialVersion: 1},
			},
		},
	}
	handler := AdminMiddleware(mustAuthority(secret), users)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("admin-ok"))
	}))

	// Non-admin role → 403 JSON.
	userToken, err := auth.GenerateLegacyWebToken("u-1", "user@test.com", auth.TokenContext{Roles: []string{"user"}, OrgID: "org-1", MembershipID: "u-1:org-1", MembershipCredentialVersion: 1, OrganizationCredentialVersion: 1}, secret)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("GET", "/api/protected", nil)
	req.Header.Set("Authorization", "Bearer "+userToken)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("role=user: expected 403, got %d", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("role=user: expected JSON content-type, got %q", ct)
	}

	// Admin role → 200.
	adminToken, err := auth.GenerateLegacyWebToken("a-1", "admin@test.com", auth.TokenContext{Roles: []string{"admin"}, OrgID: "org-1", MembershipID: "a-1:org-1", MembershipCredentialVersion: 1, OrganizationCredentialVersion: 1}, secret)
	if err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest("GET", "/api/protected", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("role=admin: expected 200, got %d", rr.Code)
	}
	if rr.Body.String() != "admin-ok" {
		t.Errorf("role=admin: unexpected body %q", rr.Body.String())
	}
}

func TestAccessTokenTTLSeparation(t *testing.T) {
	// #460 SEC-4B: the transports no longer share one access policy. Web gets
	// the short rolling bearer (renewed via the HttpOnly refresh cookie);
	// mobile keeps the workday credential until SEC-5; both ABSOLUTE sessions
	// stay at 18h — the short web bearer never slides that deadline.
	if auth.WebAccessTokenTTL != 15*time.Minute {
		t.Errorf("WebAccessTokenTTL = %v, want 15m", auth.WebAccessTokenTTL)
	}
	if auth.MobileAccessTokenTTL != 15*time.Minute {
		t.Errorf("MobileAccessTokenTTL = %v, want 15m", auth.MobileAccessTokenTTL)
	}
	if auth.TransportSessionTTL("web") != 18*time.Hour || auth.TransportSessionTTL("mobile") != 18*time.Hour {
		t.Errorf("absolute session TTLs = web %v / mobile %v, want 18h/18h", auth.TransportSessionTTL("web"), auth.TransportSessionTTL("mobile"))
	}
}

func TestRateLimitMiddleware(t *testing.T) {
	// 1 RPS, burst 2
	mw := RateLimitMiddleware(1.0, 2)
	handler := mw(okHandler())

	// Request 1 -> 200 (within burst)
	req1 := httptest.NewRequest("POST", "/api/auth/login", nil)
	req1.RemoteAddr = "192.0.2.1:12345"
	rr1 := httptest.NewRecorder()
	handler.ServeHTTP(rr1, req1)
	if rr1.Code != http.StatusOK {
		t.Errorf("request 1: expected 200, got %d", rr1.Code)
	}

	// Request 2 -> 200 (within burst)
	req2 := httptest.NewRequest("POST", "/api/auth/login", nil)
	req2.RemoteAddr = "192.0.2.1:12345"
	rr2 := httptest.NewRecorder()
	handler.ServeHTTP(rr2, req2)
	if rr2.Code != http.StatusOK {
		t.Errorf("request 2: expected 200, got %d", rr2.Code)
	}

	// Request 3 -> 429 (burst exceeded)
	req3 := httptest.NewRequest("POST", "/api/auth/login", nil)
	req3.RemoteAddr = "192.0.2.1:12345"
	rr3 := httptest.NewRecorder()
	handler.ServeHTTP(rr3, req3)
	if rr3.Code != http.StatusTooManyRequests {
		t.Errorf("request 3: expected 429, got %d", rr3.Code)
	}
	if retry := rr3.Header().Get("Retry-After"); retry == "" {
		t.Errorf("expected Retry-After header on 429")
	}

	// Different IP -> 200
	reqOther := httptest.NewRequest("POST", "/api/auth/login", nil)
	reqOther.RemoteAddr = "192.0.2.2:12345"
	rrOther := httptest.NewRecorder()
	handler.ServeHTTP(rrOther, reqOther)
	if rrOther.Code != http.StatusOK {
		t.Errorf("different IP: expected 200, got %d", rrOther.Code)
	}
}

func TestClientIP(t *testing.T) {
	// X-Forwarded-For with multiple IPs -> first IP
	req1 := httptest.NewRequest("GET", "/", nil)
	req1.Header.Set("X-Forwarded-For", "203.0.113.195, 70.41.3.18, 150.172.238.178")
	if got := clientIP(req1); got != "203.0.113.195" {
		t.Errorf("XFF multiple: got %q, want 203.0.113.195", got)
	}

	// X-Real-IP
	req2 := httptest.NewRequest("GET", "/", nil)
	req2.Header.Set("X-Real-IP", "198.51.100.42")
	if got := clientIP(req2); got != "198.51.100.42" {
		t.Errorf("X-Real-IP: got %q, want 198.51.100.42", got)
	}

	// RemoteAddr with port
	req3 := httptest.NewRequest("GET", "/", nil)
	req3.RemoteAddr = "192.0.2.50:54321"
	if got := clientIP(req3); got != "192.0.2.50" {
		t.Errorf("RemoteAddr: got %q, want 192.0.2.50", got)
	}
}

// --- Multi-org auth context (ADR-0004 / #325) ---

func orgScopedToken(t *testing.T, secret, userID, orgID string, roles []domain.UserRole) string {
	t.Helper()
	strRoles := make([]string, len(roles))
	for i, r := range roles {
		strRoles[i] = string(r)
	}
	token, err := auth.GenerateLegacyWebToken(userID, "u@test.com", auth.TokenContext{
		Roles: strRoles, OrgID: orgID, MembershipID: userID + ":" + orgID, MembershipCredentialVersion: 1, OrganizationCredentialVersion: 1,
	}, secret)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func memEntry(userID, orgID string, roles []domain.UserRole, orgActive bool) *domain.MembershipWithOrg {
	status := domain.OrganizationStatusSuspended
	if orgActive {
		status = domain.OrganizationStatusActive
	}
	return &domain.MembershipWithOrg{
		Membership: domain.Membership{
			ID: userID + ":" + orgID, OrganizationID: orgID, UserID: userID, Roles: roles,
			Status: domain.MembershipStatusActive, CredentialVersion: 1,
		},
		Organization: domain.Organization{
			ID: orgID, Name: "T", Slug: "t", Status: status, CredentialVersion: 1,
		},
	}
}

// TestAuthMiddleware_RevokedMembershipCutsAccess locks ADR-0004: a still-valid
// JWT whose membership was deactivated must not grant access on the next request.
func TestAuthMiddleware_RevokedMembershipCutsAccess(t *testing.T) {
	secret := "super-secret-test-key-0123456789"
	users := &staticUsers{
		byID: map[string]*domain.User{
			"u-1": {ID: "u-1", Email: "u@test.com", AccountStatus: domain.AccountStatusActive},
		},
		memberships: map[string]*domain.MembershipWithOrg{
			"u-1:org-1": memEntry("u-1", "org-1", []domain.UserRole{domain.RoleAdmin}, true),
		},
	}
	handler := AuthMiddleware(mustAuthority(secret), users)(okHandler())

	token := orgScopedToken(t, secret, "u-1", "org-1", []domain.UserRole{domain.RoleAdmin})
	req := httptest.NewRequest("GET", "/api/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("active membership: expected 200, got %d", rr.Code)
	}

	// Membership deactivated → access cut immediately.
	users.memberships["u-1:org-1"].Status = domain.MembershipStatusSuspended
	req = httptest.NewRequest("GET", "/api/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("revoked membership: expected 401, got %d", rr.Code)
	}
}

// TestAuthMiddleware_SuspendedOrganizationCutsAccess: org suspension cuts
// access even with an active membership.
func TestAuthMiddleware_SuspendedOrganizationCutsAccess(t *testing.T) {
	secret := "super-secret-test-key-0123456789"
	users := &staticUsers{
		byID: map[string]*domain.User{
			"u-1": {ID: "u-1", Email: "u@test.com", AccountStatus: domain.AccountStatusActive},
		},
		memberships: map[string]*domain.MembershipWithOrg{
			"u-1:org-1": memEntry("u-1", "org-1", []domain.UserRole{domain.RoleAdmin}, false),
		},
	}
	handler := AuthMiddleware(mustAuthority(secret), users)(okHandler())

	token := orgScopedToken(t, secret, "u-1", "org-1", []domain.UserRole{domain.RoleAdmin})
	req := httptest.NewRequest("GET", "/api/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("suspended organization: expected 401, got %d", rr.Code)
	}
}

// TestAuthMiddleware_OrgTokenUsesLiveMembershipRoles: the token may carry
// stale roles; AdminMiddleware must see the membership's live roles instead.
func TestAuthMiddleware_OrgTokenUsesLiveMembershipRoles(t *testing.T) {
	secret := "super-secret-test-key-0123456789"
	users := &staticUsers{
		byID: map[string]*domain.User{
			"a-1": {ID: "a-1", Email: "was-admin@test.com", AccountStatus: domain.AccountStatusActive},
		},
		memberships: map[string]*domain.MembershipWithOrg{
			// Token says admin, membership now says vendedor.
			"a-1:org-1": memEntry("a-1", "org-1", []domain.UserRole{domain.RoleVendedor}, true),
		},
	}
	handler := AdminMiddleware(mustAuthority(secret), users)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	token := orgScopedToken(t, secret, "a-1", "org-1", []domain.UserRole{domain.RoleAdmin})
	req := httptest.NewRequest("GET", "/api/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("demoted membership: expected 403, got %d", rr.Code)
	}
}

// TestAuthMiddleware_MultiRoleMembershipUsesPrimaryRole: transitional
// single-role view is Roles[0]; the F170b sweep replaces it with the union.
func TestAuthMiddleware_MultiRoleMembershipUsesPrimaryRole(t *testing.T) {
	secret := "super-secret-test-key-0123456789"
	users := &staticUsers{
		byID: map[string]*domain.User{
			"m-1": {ID: "m-1", Email: "multi@test.com", AccountStatus: domain.AccountStatusActive},
		},
		memberships: map[string]*domain.MembershipWithOrg{
			"m-1:org-1": memEntry("m-1", "org-1", []domain.UserRole{domain.RoleVendedor, domain.RoleIngeniero}, true),
		},
	}
	var seenRole string
	handler := AuthMiddleware(mustAuthority(secret), users)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims := r.Context().Value(UserContextKey).(*auth.Claims)
		seenRole = claims.Role
		w.WriteHeader(http.StatusOK)
	}))

	token := orgScopedToken(t, secret, "m-1", "org-1", []domain.UserRole{domain.RoleVendedor})
	req := httptest.NewRequest("GET", "/api/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	if seenRole != string(domain.RoleVendedor) {
		t.Fatalf("primary role = %q, want %q", seenRole, domain.RoleVendedor)
	}
}

// TestRoleMiddleware_MultiRoleTokenPassesUnion: a multi-role membership
// token passes a RoleMiddleware gate when ANY of its roles is allowed.
func TestRoleMiddleware_MultiRoleTokenPassesUnion(t *testing.T) {
	secret := "super-secret-test-key-0123456789"
	users := &staticUsers{
		byID: map[string]*domain.User{
			"m-1": {ID: "m-1", Email: "multi@test.com", AccountStatus: domain.AccountStatusActive},
		},
		memberships: map[string]*domain.MembershipWithOrg{
			"m-1:org-1": memEntry("m-1", "org-1", []domain.UserRole{domain.RoleVendedor, domain.RoleIngeniero}, true),
		},
	}
	handler := RoleMiddleware(mustAuthority(secret), users, domain.RoleIngeniero)(okHandler())

	token := orgScopedToken(t, secret, "m-1", "org-1", []domain.UserRole{domain.RoleVendedor})
	req := httptest.NewRequest("GET", "/api/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("vendedor+ingeniero debe pasar gate de ingeniero, got %d", rr.Code)
	}

	// Gate que ninguno de los dos roles satisface → 403.
	handler403 := RoleMiddleware(mustAuthority(secret), users, domain.RoleAdmin)(okHandler())
	req = httptest.NewRequest("GET", "/api/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr = httptest.NewRecorder()
	handler403.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("sin admin en el set no pasa gate admin, got %d", rr.Code)
	}
}

// --- Support sessions (ADR-0005 §5 / #326) ---

type supportSessionUsers struct {
	staticUsers
	openSession *domain.SupportSession
}

func (s *supportSessionUsers) GetOpenSupportSession(context.Context, string) (*domain.SupportSession, error) {
	if s.openSession == nil {
		return nil, errors.New("support session not found")
	}
	return s.openSession, nil
}

// TestAuthMiddleware_SupportSessionActsAsOrgAdmin: the platform admin's
// support token carries an effective admin membership of the target org while
// the actor stays the platform admin; ending the session cuts access at the
// next request.
func TestAuthMiddleware_SupportSessionActsAsOrgAdmin(t *testing.T) {
	secret := "super-secret-test-key-0123456789"
	users := &supportSessionUsers{
		staticUsers: staticUsers{
			byID: map[string]*domain.User{
				"pa-1": {ID: "pa-1", Email: "soporte@granete.test", AccountStatus: domain.AccountStatusActive, PlatformAdmin: true},
			},
		},
		openSession: &domain.SupportSession{
			ID: "ss-1", PlatformAdminUserID: "pa-1", OrganizationID: "org-9", Reason: "ayuda catálogo",
			ExpiresAt: time.Now().Add(time.Hour), OrganizationCredentialVersion: 5,
			LiveOrganizationStatus: domain.OrganizationStatusActive, LiveOrganizationCredentialVersion: 5,
		},
	}
	var seenRole string
	handler := AuthMiddleware(mustAuthority(secret), users)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims := r.Context().Value(UserContextKey).(*auth.Claims)
		seenRole = claims.Role
		w.WriteHeader(http.StatusOK)
	}))

	token, err := auth.GenerateLegacySupportToken("pa-1", "soporte@granete.test", auth.SupportClaims{
		OrgID: "org-9", SessionID: "ss-1", Reason: "ayuda catálogo", OrganizationCredentialVersion: 5,
	}, secret)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("GET", "/api/projects", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK || seenRole != string(domain.RoleAdmin) {
		t.Fatalf("support session: esperaba 200 como admin del taller, got %d role=%s", rr.Code, seenRole)
	}

	// Logout (session ended) → 401 en el request siguiente.
	users.openSession = nil
	req = httptest.NewRequest("GET", "/api/projects", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("ended support session: esperaba 401, got %d", rr.Code)
	}
}

// TestAuthMiddleware_SupportTokenRequiresPlatformAdmin: a regular user
// forging a support claim gets 401.
func TestAuthMiddleware_SupportTokenRequiresPlatformAdmin(t *testing.T) {
	secret := "super-secret-test-key-0123456789"
	users := &supportSessionUsers{
		staticUsers: staticUsers{
			byID: map[string]*domain.User{
				"u-1": {ID: "u-1", Email: "u@test.com", AccountStatus: domain.AccountStatusActive},
			},
		},
		openSession: &domain.SupportSession{
			ID: "ss-x", PlatformAdminUserID: "u-1", OrganizationID: "org-9",
			ExpiresAt: time.Now().Add(time.Hour), OrganizationCredentialVersion: 5,
			LiveOrganizationStatus: domain.OrganizationStatusActive, LiveOrganizationCredentialVersion: 5,
		},
	}
	handler := AuthMiddleware(mustAuthority(secret), users)(okHandler())
	token, _ := auth.GenerateLegacySupportToken("u-1", "u@test.com", auth.SupportClaims{
		OrgID: "org-9", SessionID: "ss-x", OrganizationCredentialVersion: 5,
	}, secret)
	req := httptest.NewRequest("GET", "/api/projects", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("forged support claim: esperaba 401, got %d", rr.Code)
	}
}

func TestAuthMiddleware_SupportSessionFailsClosedOnEveryLiveBoundary(t *testing.T) {
	secret := "super-secret-test-key-0123456789"
	tests := []struct {
		name   string
		mutate func(*supportSessionUsers)
	}{
		{"missing session", func(users *supportSessionUsers) { users.openSession = nil }},
		{"wrong session", func(users *supportSessionUsers) { users.openSession.ID = "ss-other" }},
		{"wrong admin", func(users *supportSessionUsers) { users.openSession.PlatformAdminUserID = "pa-other" }},
		{"wrong organization", func(users *supportSessionUsers) { users.openSession.OrganizationID = "org-other" }},
		{"ended", func(users *supportSessionUsers) { now := time.Now(); users.openSession.EndedAt = &now }},
		{"expired", func(users *supportSessionUsers) { users.openSession.ExpiresAt = time.Now().Add(-time.Second) }},
		{"suspended organization", func(users *supportSessionUsers) {
			users.openSession.LiveOrganizationStatus = domain.OrganizationStatusSuspended
		}},
		{"offboarding organization", func(users *supportSessionUsers) {
			users.openSession.LiveOrganizationStatus = domain.OrganizationStatusOffboarding
		}},
		{"terminated organization", func(users *supportSessionUsers) {
			users.openSession.LiveOrganizationStatus = domain.OrganizationStatusTerminated
		}},
		{"session token epoch mismatch", func(users *supportSessionUsers) { users.openSession.OrganizationCredentialVersion++ }},
		{"live organization epoch mismatch", func(users *supportSessionUsers) { users.openSession.LiveOrganizationCredentialVersion++ }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			users := &supportSessionUsers{
				staticUsers: staticUsers{byID: map[string]*domain.User{
					"pa-1": {ID: "pa-1", Email: "support@example.test", AccountStatus: domain.AccountStatusActive, PlatformAdmin: true},
				}},
				openSession: &domain.SupportSession{
					ID: "ss-1", PlatformAdminUserID: "pa-1", OrganizationID: "org-9",
					ExpiresAt: time.Now().Add(time.Hour), OrganizationCredentialVersion: 5,
					LiveOrganizationStatus: domain.OrganizationStatusActive, LiveOrganizationCredentialVersion: 5,
				},
			}
			test.mutate(users)
			token, err := auth.GenerateLegacySupportToken("pa-1", "support@example.test", auth.SupportClaims{
				OrgID: "org-9", SessionID: "ss-1", OrganizationCredentialVersion: 5,
			}, secret)
			if err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest(http.MethodGet, "/api/projects", nil)
			req.Header.Set("Authorization", "Bearer "+token)
			recorder := httptest.NewRecorder()
			AuthMiddleware(mustAuthority(secret), users)(okHandler()).ServeHTTP(recorder, req)
			if recorder.Code != http.StatusUnauthorized {
				t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
			}
		})
	}
}

func TestAuthMiddleware_RejectsMembershipIdentityCredentialAndSessionRevocationMismatches(t *testing.T) {
	secret := "super-secret-test-key-0123456789"
	started := time.Now().UTC().Add(-time.Hour)
	membership := memEntry("u-1", "org-1", []domain.UserRole{domain.RoleAdmin}, true)
	users := &staticUsers{
		byID: map[string]*domain.User{
			"u-1": {ID: "u-1", Email: "u@test.com", AccountStatus: domain.AccountStatusActive},
		},
		memberships: map[string]*domain.MembershipWithOrg{"u-1:org-1": membership},
	}
	token, err := auth.GenerateLegacyWebToken("u-1", "u@test.com", auth.TokenContext{
		Roles: []string{"admin"}, OrgID: "org-1", MembershipID: membership.ID,
		MembershipCredentialVersion: membership.CredentialVersion, OrganizationCredentialVersion: membership.Organization.CredentialVersion, AuthStartedAt: started,
	}, secret)
	if err != nil {
		t.Fatal(err)
	}

	serve := func() int {
		req := httptest.NewRequest(http.MethodGet, "/api/protected", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rr := httptest.NewRecorder()
		AuthMiddleware(mustAuthority(secret), users)(okHandler()).ServeHTTP(rr, req)
		return rr.Code
	}
	if got := serve(); got != http.StatusOK {
		t.Fatalf("matching live membership = %d, want 200", got)
	}

	membership.ID = "replacement-membership"
	if got := serve(); got != http.StatusUnauthorized {
		t.Fatalf("membership identity replacement = %d, want 401", got)
	}
	membership.ID = "u-1:org-1"
	membership.CredentialVersion++
	if got := serve(); got != http.StatusUnauthorized {
		t.Fatalf("credential revocation = %d, want 401", got)
	}
	membership.CredentialVersion--
	membership.Organization.CredentialVersion++
	if got := serve(); got != http.StatusUnauthorized {
		t.Fatalf("organization lifecycle revocation = %d, want 401", got)
	}
	membership.Organization.CredentialVersion--
	revokedAt := started.Add(time.Minute)
	membership.SessionsRevokedAt = &revokedAt
	if got := serve(); got != http.StatusUnauthorized {
		t.Fatalf("revoked-after-auth-start = %d, want 401", got)
	}
}

// TestExtensionClientBoundaryProjectFurniture pins the #389 / DT-5 capability
// grants for the SketchUp extension credential: the Project Furniture panel
// reads the connected project's furniture instances and the design working
// copy, and Place-existing is the credential's ONLY write (PUT working-copy).
// Creating furniture identities (POST /furniture-instances, #390) stays
// DENIED: placing an existing unit must never mint business objects.
func TestExtensionClientBoundaryProjectFurniture(t *testing.T) {
	projectID := "41000000-0000-0000-0000-000000000001"
	designID := "52000000-0000-0000-0000-000000000001"
	cases := []struct {
		name string
		verb string
		path string
		want bool
	}{
		// #389 grants.
		{"list project furniture instances", http.MethodGet, "/api/projects/" + projectID + "/furniture-instances", true},
		{"read design working copy", http.MethodGet, "/api/designs/" + designID + "/working-copy", true},
		{"place existing writes working copy", http.MethodPut, "/api/designs/" + designID + "/working-copy", true},
		// #390 / DT-6 grant: catalog design-first identity creation.
		{"create furniture instance from catalog (#390)", http.MethodPost, "/api/projects/" + projectID + "/furniture-instances", true},
		// #391 / DT-7 grant: duplicate furniture instance.
		{"duplicate furniture instance (#391)", http.MethodPost, "/api/projects/" + projectID + "/furniture-instances/" + projectID + ":duplicate", true},
		{"remove furniture instance (#385) denied", http.MethodPost, "/api/furniture-instances/" + projectID + ":remove", false},
		{"reset working copy", http.MethodPost, "/api/designs/" + designID + "/working-copy:reset", false},
		{"publish revision (#392)", http.MethodPost, "/api/designs/" + designID + "/revisions", false},
		// Surrounding surface stays closed.
		{"project detail reads", http.MethodGet, "/api/projects/" + projectID, false},
		{"quote line links", http.MethodGet, "/api/projects/" + projectID + "/quote-lines/" + projectID + "/furniture-instances", false},
		{"put elsewhere", http.MethodPut, "/api/projects/" + projectID, false},
		{"delete verb", http.MethodDelete, "/api/designs/" + designID + "/working-copy", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := extensionClientMayAccess(tc.verb, tc.path); got != tc.want {
				t.Fatalf("extensionClientMayAccess(%s %s) = %v, want %v", tc.verb, tc.path, got, tc.want)
			}
		})
	}
}
