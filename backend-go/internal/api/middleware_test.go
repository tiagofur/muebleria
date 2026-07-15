package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/auth"
)

func TestCORSMiddleware(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	corsHandler := CORSMiddleware(handler)

	// Test OPTIONS request
	req := httptest.NewRequest("OPTIONS", "/api/any", nil)
	rr := httptest.NewRecorder()
	corsHandler.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Errorf("expected status NoContent, got %d", rr.Code)
	}

	if rr.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Errorf("expected Access-Control-Allow-Origin to be '*', got %s", rr.Header().Get("Access-Control-Allow-Origin"))
	}

	// Test GET request
	reqGET := httptest.NewRequest("GET", "/api/any", nil)
	rrGET := httptest.NewRecorder()
	corsHandler.ServeHTTP(rrGET, reqGET)

	if rrGET.Code != http.StatusOK {
		t.Errorf("expected status OK, got %d", rrGET.Code)
	}
}

func TestAuthMiddleware(t *testing.T) {
	secret := "super-secret"
	middleware := AuthMiddleware(secret)

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := r.Context().Value(UserContextKey).(*auth.Claims)
		if !ok || claims == nil {
			http.Error(w, "no claims found", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(claims.Email))
	})

	authenticatedHandler := middleware(handler)

	// Case 1: No Authorization header
	req := httptest.NewRequest("GET", "/api/protected", nil)
	rr := httptest.NewRecorder()
	authenticatedHandler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected status Unauthorized, got %d", rr.Code)
	}

	// Case 2: Invalid format
	req = httptest.NewRequest("GET", "/api/protected", nil)
	req.Header.Set("Authorization", "InvalidFormat token-here")
	rr = httptest.NewRecorder()
	authenticatedHandler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected status Unauthorized, got %d", rr.Code)
	}

	// Case 3: Valid Token
	token, err := auth.GenerateToken("user-1", "user@test.com", "admin", secret)
	if err != nil {
		t.Fatal(err)
	}

	req = httptest.NewRequest("GET", "/api/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr = httptest.NewRecorder()
	authenticatedHandler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status OK, got %d", rr.Code)
	}

	if rr.Body.String() != "user@test.com" {
		t.Errorf("expected body to contain user@test.com, got %s", rr.Body.String())
	}
}

func TestAdminMiddleware(t *testing.T) {
	secret := "super-secret"
	adminMW := AdminMiddleware(secret)
	handler := adminMW(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("admin-ok"))
	}))

	// Non-admin role → 403
	userToken, err := auth.GenerateToken("u-1", "user@test.com", "user", secret)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("GET", "/api/admin/users", nil)
	req.Header.Set("Authorization", "Bearer "+userToken)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("expected Forbidden for role=user, got %d", rr.Code)
	}

	// Admin role → 200
	adminToken, err := auth.GenerateToken("a-1", "admin@test.com", "admin", secret)
	if err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest("GET", "/api/admin/users", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("expected OK for role=admin, got %d", rr.Code)
	}
	if rr.Body.String() != "admin-ok" {
		t.Errorf("expected admin-ok body, got %s", rr.Body.String())
	}
}
