package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/auth"
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
	middleware := AuthMiddleware(secret)

	handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := r.Context().Value(UserContextKey).(*auth.Claims)
		if !ok || claims == nil {
			http.Error(w, "no claims found", http.StatusInternalServerError)
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

	// Case 4: Valid Token → 200.
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

func TestAdminMiddleware(t *testing.T) {
	secret := "super-secret-test-key-0123456789"
	handler := AdminMiddleware(secret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
		t.Errorf("role=admin: expected admin-ok body, got %s", rr.Body.String())
	}
}

// TestRateLimitMiddleware verifies that a burst of requests is throttled with a
// 429 + Retry-After once the bucket is exhausted.
func TestRateLimitMiddleware(t *testing.T) {
	// rps=1, burst=3 → allow 3 immediately, then throttle.
	handler := RateLimitMiddleware(1, 3)(okHandler())

	allowed := 0
	throttled := false
	for i := 0; i < 6; i++ {
		req := httptest.NewRequest("POST", "/api/auth/login", nil)
		// Distinct IPs would each get their own bucket; here same IP → shared.
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		switch rr.Code {
		case http.StatusOK:
			allowed++
		case http.StatusTooManyRequests:
			throttled = true
			if rr.Header().Get("Retry-After") == "" {
				t.Errorf("expected Retry-After header on 429")
			}
		default:
			t.Fatalf("unexpected status %d on request %d", rr.Code, i)
		}
	}
	if allowed != 3 {
		t.Errorf("expected 3 requests allowed (burst), got %d", allowed)
	}
	if !throttled {
		t.Errorf("expected at least one throttled (429) response")
	}
}

// TestRateLimitMiddlewarePerIP verifies buckets are isolated per client IP.
func TestRateLimitMiddlewarePerIP(t *testing.T) {
	handler := RateLimitMiddleware(1, 1)(okHandler())

	// IP A uses up its bucket.
	reqA := httptest.NewRequest("POST", "/api/auth/login", nil)
	reqA.RemoteAddr = "10.0.0.1:1234"
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, reqA)
	if rr.Code != http.StatusOK {
		t.Fatalf("IP A first: expected 200, got %d", rr.Code)
	}

	// IP B still gets its own fresh bucket.
	reqB := httptest.NewRequest("POST", "/api/auth/login", nil)
	reqB.RemoteAddr = "10.0.0.2:5678"
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, reqB)
	if rr.Code != http.StatusOK {
		t.Errorf("IP B first: expected 200 (own bucket), got %d", rr.Code)
	}

	// IP A second request → throttled.
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, reqA)
	if rr.Code != http.StatusTooManyRequests {
		t.Errorf("IP A second: expected 429, got %d", rr.Code)
	}
}

// Smoke: itoa helper produces correct decimal strings.
func TestItoa(t *testing.T) {
	cases := map[int]string{0: "0", 1: "1", 9: "9", 10: "10", 42: "42", 60: "60", -1: "-1"}
	for in, want := range cases {
		if got := itoa(in); got != want {
			t.Errorf("itoa(%d) = %q, want %q", in, got, want)
		}
	}
}
