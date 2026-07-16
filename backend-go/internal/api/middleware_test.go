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
	byID map[string]*domain.User
	err  error
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
	token, err := auth.GenerateToken("user-1", "user@test.com", "admin", secret)
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

	token, err := auth.GenerateToken("user-1", "user@test.com", "admin", secret)
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

	adminToken, err := auth.GenerateToken("a-1", "was-admin@test.com", "admin", secret)
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
	userToken, err := auth.GenerateToken("u-1", "user@test.com", "user", secret)
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
	adminToken, err := auth.GenerateToken("a-1", "admin@test.com", "admin", secret)
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
