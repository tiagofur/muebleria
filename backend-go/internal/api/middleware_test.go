package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

func okHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}
}

// errorBody parses the JSON error envelope used by respondWithError.
func errorBody(t *testing.T, rr *httptest.ResponseRecorder) string {
	t.Helper()
	var m map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &m); err != nil {
		t.Fatalf("response is not a JSON error envelope: %v (body=%q)", err, rr.Body.String())
	}
	return m["error"]
}

// staticUsers implements UserLookup for middleware tests.
type staticUsers struct {
	byID        map[string]*domain.User
	err         error
	memberships map[string]*domain.MembershipWithOrg
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
	users := &staticUsers{byID: map[string]*domain.User{
		"user-1": {
			ID: "user-1", Email: "user@test.com",
			Role: domain.RoleAdmin, Active: true,
		},
	}}
	middleware := AuthMiddleware(secret, users)

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

	// Case 4: Valid Token + active user in DB → 200.
	token, err := auth.GenerateToken("user-1", "user@test.com", auth.TokenContext{Roles: []string{"admin"}}, secret)
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

// TestAuthMiddleware_RejectsDeactivatedUser locks issue #16: a still-valid JWT
// for a user who was deactivated must not grant access.
func TestAuthMiddleware_RejectsDeactivatedUser(t *testing.T) {
	secret := "super-secret-test-key-0123456789"
	users := &staticUsers{byID: map[string]*domain.User{
		"user-1": {
			ID: "user-1", Email: "user@test.com",
			Role: domain.RoleAdmin, Active: false,
		},
	}}
	handler := AuthMiddleware(secret, users)(okHandler())

	token, err := auth.GenerateToken("user-1", "user@test.com", auth.TokenContext{Roles: []string{"admin"}}, secret)
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
	// Token was minted as admin, but DB now says user.
	users := &staticUsers{byID: map[string]*domain.User{
		"a-1": {
			ID: "a-1", Email: "was-admin@test.com",
			Role: domain.RoleUser, Active: true,
		},
	}}
	handler := AdminMiddleware(secret, users)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("admin-ok"))
	}))

	adminToken, err := auth.GenerateToken("a-1", "was-admin@test.com", auth.TokenContext{Roles: []string{"admin"}}, secret)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("GET", "/api/admin/users", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("demoted admin: expected 403, got %d (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestAdminMiddleware(t *testing.T) {
	secret := "super-secret-test-key-0123456789"
	users := &staticUsers{byID: map[string]*domain.User{
		"u-1": {ID: "u-1", Email: "user@test.com", Role: domain.RoleUser, Active: true},
		"a-1": {ID: "a-1", Email: "admin@test.com", Role: domain.RoleAdmin, Active: true},
	}}
	handler := AdminMiddleware(secret, users)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("admin-ok"))
	}))

	// Non-admin role → 403 JSON.
	userToken, err := auth.GenerateToken("u-1", "user@test.com", auth.TokenContext{Roles: []string{"user"}}, secret)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("GET", "/api/admin/users", nil)
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
	adminToken, err := auth.GenerateToken("a-1", "admin@test.com", auth.TokenContext{Roles: []string{"admin"}}, secret)
	if err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest("GET", "/api/admin/users", nil)
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

func TestAccessTokenTTLIsFifteenMinutes(t *testing.T) {
	if auth.AccessTokenTTL != 15*60*1e9 && auth.AccessTokenTTL.Minutes() != 15 {
		// Use Minutes() for clarity
		t.Errorf("AccessTokenTTL = %v, want 15m (issue #16)", auth.AccessTokenTTL)
	}
	if auth.AccessTokenTTL.Minutes() != 15 {
		t.Errorf("AccessTokenTTL = %v, want 15 minutes", auth.AccessTokenTTL)
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
	token, err := auth.GenerateToken(userID, "u@test.com", auth.TokenContext{
		Roles: strRoles, OrgID: orgID,
	}, secret)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func memEntry(userID, orgID string, roles []domain.UserRole, orgActive bool) *domain.MembershipWithOrg {
	return &domain.MembershipWithOrg{
		Membership: domain.Membership{
			OrganizationID: orgID, UserID: userID, Roles: roles, Active: true,
		},
		Organization: domain.Organization{
			ID: orgID, Name: "T", Slug: "t", Active: orgActive,
			LicensePlan: domain.LicensePlanNone,
		},
	}
}

// TestAuthMiddleware_RevokedMembershipCutsAccess locks ADR-0004: a still-valid
// JWT whose membership was deactivated must not grant access on the next request.
func TestAuthMiddleware_RevokedMembershipCutsAccess(t *testing.T) {
	secret := "super-secret-test-key-0123456789"
	users := &staticUsers{
		byID: map[string]*domain.User{
			"u-1": {ID: "u-1", Email: "u@test.com", Role: domain.RoleAdmin, Active: true},
		},
		memberships: map[string]*domain.MembershipWithOrg{
			"u-1:org-1": memEntry("u-1", "org-1", []domain.UserRole{domain.RoleAdmin}, true),
		},
	}
	handler := AuthMiddleware(secret, users)(okHandler())

	token := orgScopedToken(t, secret, "u-1", "org-1", []domain.UserRole{domain.RoleAdmin})
	req := httptest.NewRequest("GET", "/api/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("active membership: expected 200, got %d", rr.Code)
	}

	// Membership deactivated → access cut immediately.
	users.memberships["u-1:org-1"].Active = false
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
			"u-1": {ID: "u-1", Email: "u@test.com", Role: domain.RoleAdmin, Active: true},
		},
		memberships: map[string]*domain.MembershipWithOrg{
			"u-1:org-1": memEntry("u-1", "org-1", []domain.UserRole{domain.RoleAdmin}, false),
		},
	}
	handler := AuthMiddleware(secret, users)(okHandler())

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
			"a-1": {ID: "a-1", Email: "was-admin@test.com", Role: domain.RoleAdmin, Active: true},
		},
		memberships: map[string]*domain.MembershipWithOrg{
			// Token says admin, membership now says vendedor.
			"a-1:org-1": memEntry("a-1", "org-1", []domain.UserRole{domain.RoleVendedor}, true),
		},
	}
	handler := AdminMiddleware(secret, users)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	token := orgScopedToken(t, secret, "a-1", "org-1", []domain.UserRole{domain.RoleAdmin})
	req := httptest.NewRequest("GET", "/api/admin/users", nil)
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
			"m-1": {ID: "m-1", Email: "multi@test.com", Role: domain.RoleUser, Active: true},
		},
		memberships: map[string]*domain.MembershipWithOrg{
			"m-1:org-1": memEntry("m-1", "org-1", []domain.UserRole{domain.RoleVendedor, domain.RoleIngeniero}, true),
		},
	}
	var seenRole string
	handler := AuthMiddleware(secret, users)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
			"m-1": {ID: "m-1", Email: "multi@test.com", Role: domain.RoleUser, Active: true},
		},
		memberships: map[string]*domain.MembershipWithOrg{
			"m-1:org-1": memEntry("m-1", "org-1", []domain.UserRole{domain.RoleVendedor, domain.RoleIngeniero}, true),
		},
	}
	handler := RoleMiddleware(secret, users, domain.RoleIngeniero)(okHandler())

	token := orgScopedToken(t, secret, "m-1", "org-1", []domain.UserRole{domain.RoleVendedor})
	req := httptest.NewRequest("GET", "/api/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("vendedor+ingeniero debe pasar gate de ingeniero, got %d", rr.Code)
	}

	// Gate que ninguno de los dos roles satisface → 403.
	handler403 := RoleMiddleware(secret, users, domain.RoleAdmin)(okHandler())
	req = httptest.NewRequest("GET", "/api/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr = httptest.NewRecorder()
	handler403.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("sin admin en el set no pasa gate admin, got %d", rr.Code)
	}
}
